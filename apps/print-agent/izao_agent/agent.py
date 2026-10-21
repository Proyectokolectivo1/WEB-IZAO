"""Bucle principal del agente.

Garantías (ver store.py y docs/DECISIONES.md D-028):
  1. Una guía nunca se imprime dos veces automáticamente: el intento queda anotado en SQLite (fase `printing`)
     ANTES de lanzar SumatraPDF; si el agente muere después, al reiniciar ese trabajo NO se reimprime.
  2. Un tiempo agotado de SumatraPDF tampoco se reintenta (no se sabe si salió el papel).
  3. Si el servidor no recibió el resultado, se reintenta el AVISO (no la impresión) hasta lograrlo.
"""

from __future__ import annotations

import json
import logging
import os
import random
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from pydantic import ValidationError

from . import CONTRACT_VERSION, __version__
from .api import AgentApi, ApiError, AuthError, ClaimedJob, PermanentError, TransientError
from .config import LocalConfig, RemoteConfig, effective_print_settings, parse_remote
from .logging_setup import redact
from .panel import NeedsLogin, PanelError, PanelSession
from .printer import PrintService
from .store import INTERRUPTED_MESSAGE, Store

log = logging.getLogger("izao.agent")

_ERROR_PRIORITY = ("printer", "print", "panel", "net")


class Deferred(Exception):
    """No se puede avanzar ahora (sin red, sin sesión, sin impresora): se reintenta en el próximo ciclo."""


class Agent:
    def __init__(
        self,
        cfg: LocalConfig,
        api: AgentApi,
        store: Store,
        printer: PrintService,
        *,
        labels_dir: Path,
        screenshots_dir: Path,
        panel: PanelSession | None = None,
        alive_path: Path | None = None,
        sleep: Callable[[float], None] = time.sleep,
        retry_delay: float = 3.0,
    ):
        self.cfg = cfg
        self.api = api
        self.store = store
        self.printer = printer
        self.labels_dir = labels_dir
        self.screenshots_dir = screenshots_dir
        self.panel = panel
        self.alive_path = alive_path
        self._sleep = sleep
        self._retry_delay = retry_delay
        self.remote: RemoteConfig | None = None
        self._errors: dict[str, str] = {}
        self._elock = threading.Lock()
        self._fetch_failures: dict[str, int] = {}
        self._panel_checked = False
        self._panel_next_check = 0.0
        self._last_cleanup = 0.0

    # ------------------------------------------------------------------ estado compartido
    def set_error(self, key: str, message: str | None) -> None:
        with self._elock:
            if message:
                self._errors[key] = redact(message)[:400]
            else:
                self._errors.pop(key, None)

    @property
    def last_error(self) -> str | None:
        with self._elock:
            for k in _ERROR_PRIORITY:
                if k in self._errors:
                    return self._errors[k][:500]
        return None

    def touch_alive(self) -> None:
        if self.alive_path:
            try:
                self.alive_path.write_text(str(time.time()), encoding="utf-8")
            except OSError:
                pass

    @property
    def mode(self) -> str:
        return self.remote.mode if self.remote else "api"

    def _panel_active(self) -> bool:
        return self.mode == "panel" and self.panel is not None and self.remote is not None and self.remote.panel is not None

    def intervals(self):
        return (self.remote.intervals if self.remote and self.remote.intervals else self.cfg.intervals)

    # ------------------------------------------------------------------ arranque y configuración
    def startup(self) -> None:
        interrupted = self.store.recover_interrupted()
        for job_id in interrupted:
            log.warning("Trabajo %s quedó a medias en un reinicio: NO se reimprime (se avisará al servidor)", job_id)
        cached = self.store.meta_get("remote_config")
        if cached:
            try:
                self.remote = parse_remote(json.loads(cached))
            except (ValueError, ValidationError):
                self.remote = None
        self.cleanup_old()
        self.touch_alive()

    def refresh_config(self) -> None:
        try:
            data = self.api.get_config()
            remote = parse_remote(data)
        except ApiError as exc:
            log.warning("No pude leer la configuración remota: %s", exc)
            return
        except ValidationError:
            log.warning("La configuración remota tiene datos no válidos; sigo con la anterior")
            self.set_error("net", "Configuración remota no válida")
            return
        if remote.contract_version != CONTRACT_VERSION:
            log.warning("El servidor usa el contrato v%s y este agente el v%s", remote.contract_version, CONTRACT_VERSION)
        self.remote = remote
        self.store.meta_set("remote_config", json.dumps(data))
        log.info("Configuración remota %s aplicada (modo %s)", remote.config_version or "-", remote.mode)

    # ------------------------------------------------------------------ heartbeat
    def heartbeat_once(self) -> None:
        printer_ok = self.printer.printer_available()
        if not self.cfg.printer:
            self.set_error("printer", "No hay impresora configurada en config.yaml")
        elif not printer_ok:
            self.set_error("printer", f"No encuentro la impresora '{self.cfg.printer}'")
        else:
            self.set_error("printer", None)
        payload: dict = {
            "version": __version__,
            "printer": self.cfg.printer or None,
            "printer_ok": printer_ok,
            "queue_size": self.store.queue_size(),
            "last_error": self.last_error,
        }
        if self.mode == "panel":
            payload["panel_state"] = self.panel.state if self._panel_active() else "disabled"
        resp = self.api.heartbeat(payload)
        server_version = str(resp.get("config_version", ""))
        if self.remote is None or (server_version and server_version != self.remote.config_version):
            self.refresh_config()

    # ------------------------------------------------------------------ trabajo
    def work_once(self) -> int:
        """Un ciclo: avisar resultados pendientes, retomar lo local, reclamar y procesar. Devuelve cuántos procesó."""
        processed = 0
        self.flush_reports()
        for row in self._unfinished_rows():
            processed += self._safe_process(row["id"])
        if self._claim_allowed():
            max_jobs = min(self.cfg.max_claim, (self.remote.max_claim if self.remote and self.remote.max_claim else 5))
            for job in self.api.claim(max_jobs):
                self.store.register(job.id, job.type, job.order_number, job.reprint, job.claimed_at)
                processed += self._safe_process(job.id)
        self.flush_reports()
        self.touch_alive()
        self._maybe_cleanup()
        return processed

    def _unfinished_rows(self):
        return self.store.unfinished()

    def _claim_allowed(self) -> bool:
        if not self.printer.printer_available():
            return False
        if self._panel_active():
            now = time.monotonic()
            if not self._panel_checked or (self.panel.state != "ok" and now >= self._panel_next_check):
                self._panel_checked = True
                self.panel.check_session()
                self._panel_next_check = now + self.intervals().panel_retry_seconds
                self.set_error("panel", None if self.panel.state == "ok" else "El agente necesita que inicies sesión en MasterShop")
            return self.panel.state == "ok"
        return True

    def _safe_process(self, job_id: str) -> int:
        try:
            self.process(job_id)
            return 1
        except Deferred as exc:
            log.info("Trabajo %s en espera: %s", job_id, exc)
            return 0
        except AuthError:
            raise
        except Exception as exc:  # un trabajo defectuoso no debe tumbar el ciclo
            log.exception("Error inesperado en el trabajo %s", job_id)
            self.set_error("print", f"Error inesperado: {type(exc).__name__}")
            return 0

    # ------------------------------------------------------------------ un trabajo
    def process(self, job_id: str) -> None:
        row = self.store.get(job_id)
        if row is None or row["phase"] == "finished":
            return  # ya decidido: solo falta avisar (flush_reports)
        if row["phase"] == "printing":
            # Solo puede pasar si algo dejó la fase a medias dentro de este mismo proceso: nunca reimprimir.
            self.store.finish(job_id, "failed", INTERRUPTED_MESSAGE)
            return

        # Defensa en profundidad: el servidor solo crea un trabajo automático por envío, pero si llegara otro
        # para una guía ya impresa aquí, no se imprime de nuevo. (Las reimpresiones manuales sí se imprimen.)
        if not row["reprint"] and row["type"] == "label" and row["order_number"]:
            prev = self.store.printed_for_order(row["order_number"], "label", job_id)
            if prev is not None:
                log.warning("La guía del pedido %s ya se imprimió (trabajo %s); no se repite", row["order_number"], prev["id"])
                self.store.finish(job_id, "printed")
                return

        if not self.printer.printer_available():
            self._wait_or_fail_for_printer(row)
            return

        pdf = self._ensure_pdf(row)
        settings, _ = effective_print_settings(self.cfg, self.remote)
        last_error = "Error sin detalle"
        attempts = row["attempts"]
        while attempts < self.cfg.max_print_attempts:
            attempts = self.store.begin_attempt(job_id)  # queda en disco antes de lanzar SumatraPDF
            try:
                outcome = self.printer.print_pdf(pdf, settings)
            except Exception as exc:
                log.exception("Fallo inesperado al imprimir %s", job_id)
                self.store.finish(job_id, "failed", f"Error inesperado al imprimir ({type(exc).__name__}); puede haberse impreso")
                self.set_error("print", "Error inesperado al imprimir")
                return
            self.touch_alive()
            if outcome.ok:
                self.store.finish(job_id, "printed")
                self.set_error("print", None)
                log.info("Trabajo %s impreso (intento %s)", job_id, attempts)
                return
            last_error = outcome.error or last_error
            log.warning("Intento %s/%s falló: %s", attempts, self.cfg.max_print_attempts, last_error)
            if outcome.ambiguous or outcome.fatal:
                self.store.finish(job_id, "failed", last_error)
                self.set_error("print", last_error)
                return
            self.store.back_to_downloaded(job_id)
            if attempts < self.cfg.max_print_attempts:
                self._sleep(self._retry_delay)
        self.store.finish(job_id, "failed", f"{last_error} (tras {attempts} intentos)")
        self.set_error("print", last_error)

    def _age(self, iso: str) -> timedelta:
        return datetime.now(timezone.utc) - datetime.fromisoformat(iso)

    def _wait_or_fail_for_printer(self, row) -> None:
        if self._age(row["created_at"]) > timedelta(minutes=self.cfg.printer_wait_minutes):
            msg = f"La impresora '{self.cfg.printer}' no estuvo disponible en {self.cfg.printer_wait_minutes} minutos"
            self.store.finish(row["id"], "failed", msg)
            self.set_error("print", msg)
            return
        raise Deferred("impresora no disponible")

    # ------------------------------------------------------------------ obtener el PDF
    def _ensure_pdf(self, row) -> Path:
        job_id = row["id"]
        existing = row["pdf_path"]
        if existing and Path(existing).is_file() and Path(existing).stat().st_size > 0:
            return Path(existing)
        target = self.labels_dir / f"{job_id}.pdf"
        try:
            if self._panel_active() and row["type"] == "label" and self.remote.panel.step("obtener_guia"):
                self._fetch_from_panel(row, target)
            else:
                self._fetch_from_api(job_id, target)
        except PermanentError as exc:
            msg = f"El servidor no entregó la guía ({exc.status} {exc.code})"
            self.store.finish(job_id, "failed", msg)
            self.set_error("print", msg)
            raise Deferred(msg) from exc
        except (TransientError, AuthError) as exc:
            raise Deferred(f"sin conexión para descargar la guía ({exc})") from exc
        self.store.set_downloaded(job_id, str(target))
        return target

    def _fetch_from_api(self, job_id: str, target: Path) -> None:
        data = self.api.download_label(job_id)
        if not data.startswith(b"%PDF-"):
            # No es un PDF: fallo definitivo del contenido, no de la red.
            raise PermanentError(200, "no_es_pdf")
        tmp = target.with_suffix(".part")
        tmp.write_bytes(data)
        os.replace(tmp, target)

    def _fetch_from_panel(self, row, target: Path) -> None:
        assert self.panel is not None and self.remote is not None and self.remote.panel is not None
        job_id = row["id"]
        variables = {"order_number": row["order_number"] or "", "job_id": job_id}
        try:
            if self.remote.panel.step("confirmar"):
                self.panel.run_step("confirmar", variables)
            got = self.panel.run_step("obtener_guia", variables, download_to=target)
            if got is None or not target.is_file() or not target.read_bytes()[:5] == b"%PDF-":
                raise PanelError("El panel no entregó un PDF")
        except NeedsLogin as exc:
            self.set_error("panel", "El agente necesita que inicies sesión en MasterShop")
            self._panel_next_check = time.monotonic() + self.intervals().panel_retry_seconds
            raise Deferred(str(exc)) from exc
        except PanelError as exc:
            n = self._fetch_failures.get(job_id, 0) + 1
            self._fetch_failures[job_id] = n
            shot_path = self._save_screenshot(job_id, exc.screenshot)
            log.warning("Modo panel: intento %s/%s falló: %s", n, self.cfg.max_print_attempts, exc)
            if n >= self.cfg.max_print_attempts:
                msg = f"{exc} (tras {n} intentos en el panel)"
                self.store.finish(job_id, "failed", msg, shot_path)
                self.set_error("panel", str(exc))
                raise Deferred(msg) from exc
            raise Deferred(str(exc)) from exc

    def _save_screenshot(self, job_id: str, data: bytes | None) -> str | None:
        if not data:
            return None
        path = self.screenshots_dir / f"{job_id}.png"
        try:
            path.write_bytes(data)
            return str(path)
        except OSError:
            return None

    # ------------------------------------------------------------------ avisar al servidor
    def flush_reports(self) -> None:
        for row in self.store.pending_reports():
            shot = None
            if row["screenshot_path"]:
                try:
                    shot = Path(row["screenshot_path"]).read_bytes()
                except OSError:
                    shot = None
            status = row["result_status"]
            error = row["result_error"] or ("Error sin detalle" if status == "failed" else None)
            try:
                self.api.post_result(row["id"], status, max(1, row["attempts"]), error, shot)
            except PermanentError as exc:
                # 409/404/400: el servidor no aceptará este resultado; reintentar no cambia nada.
                log.warning("El servidor rechazó el resultado de %s (%s); lo doy por avisado", row["id"], exc)
                self.store.mark_reported(row["id"])
                continue
            except ApiError as exc:
                self.store.bump_report_tries(row["id"])
                log.warning("No pude avisar el resultado de %s todavía: %s", row["id"], exc)
                if isinstance(exc, AuthError):
                    raise
                return  # el servidor no responde: probar de nuevo en el próximo ciclo
            self.store.mark_reported(row["id"])
            log.info("Resultado de %s avisado al servidor (%s)", row["id"], status)

    # ------------------------------------------------------------------ mantenimiento
    def _maybe_cleanup(self) -> None:
        if time.monotonic() - self._last_cleanup > 86400:
            self.cleanup_old()

    def cleanup_old(self) -> None:
        self._last_cleanup = time.monotonic()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=self.cfg.keep_labels_days)).isoformat()
        removed = 0
        for p in self.store.old_pdf_paths(cutoff):
            try:
                Path(p).unlink(missing_ok=True)
                removed += 1
            except OSError:
                pass
        self.store.purge_old((datetime.now(timezone.utc) - timedelta(days=180)).isoformat())
        if removed:
            log.info("Limpieza: %s guías antiguas borradas", removed)

    # ------------------------------------------------------------------ hilos
    def _loop(self, fn: Callable[[], object], interval: Callable[[], float], stop: threading.Event) -> None:
        failures = 0
        while not stop.is_set():
            try:
                fn()
                failures = 0
                self.set_error("net", None)
            except AuthError as exc:
                failures += 1
                self.set_error("net", str(exc))
                log.error("%s", exc)
            except ApiError as exc:
                failures += 1
                self.set_error("net", f"Sin conexión con el servidor: {exc}")
                log.warning("Servidor no disponible: %s", exc)
            except Exception:
                failures += 1
                log.exception("Error inesperado en el ciclo")
            base = float(interval())
            delay = base if failures == 0 else min(base * (2 ** min(failures, 5)), 300.0)
            if failures and delay > base:
                delay *= random.uniform(0.8, 1.2)
            stop.wait(delay)

    def _work_thread(self, stop: threading.Event) -> None:
        try:
            self._loop(self.work_once, lambda: self.intervals().claim_seconds, stop)
        finally:
            if self.panel:  # Playwright síncrono: se cierra en el mismo hilo que lo abrió
                self.panel.close()

    def run(self, stop: threading.Event) -> None:
        self.startup()
        self.refresh_config()
        threads = [
            threading.Thread(target=self._loop, args=(self.heartbeat_once, lambda: self.intervals().heartbeat_seconds, stop), name="heartbeat", daemon=True),
            threading.Thread(target=self._work_thread, args=(stop,), name="trabajo", daemon=True),
        ]
        for t in threads:
            t.start()
        log.info("Agente %s en marcha (impresora: %s)", __version__, self.cfg.printer or "sin configurar")
        stop.wait()
        for t in threads:
            t.join(timeout=30)
        log.info("Agente detenido")
