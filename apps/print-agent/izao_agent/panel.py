"""Modo panel (respaldo): opera el panel web de MasterShop con Playwright y Chrome instalado.

- Chrome real (`channel="chrome"`), con ventana y perfil persistente dedicado: la persona inició sesión una vez,
  así el control de Cloudflare se supera como un usuario normal. El agente no intenta saltarlo: si aparece,
  se pausa (`needs_login`), se pide ayuda y se reintenta cada `panel_retry_seconds`.
- Pasos y selectores vienen SIEMPRE de la configuración remota (`PanelConfig`); aquí no hay ninguno.
- Los PDF se descargan (preferencia `plugins.always_open_pdf_externally`) y se captura el evento de descarga;
  nunca se usa el diálogo de impresión del sistema. La impresión la hace SumatraPDF sobre el archivo.
- Playwright (API síncrona) debe usarse siempre desde el mismo hilo que lo creó: lo posee el hilo de trabajo.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from .config import PanelAction, PanelConfig

log = logging.getLogger("izao.panel")


class PanelError(Exception):
    def __init__(self, message: str, screenshot: bytes | None = None):
        super().__init__(message)
        self.screenshot = screenshot


class NeedsLogin(PanelError):
    """Sesión perdida o reto de Cloudflare: hace falta una persona."""


def prepare_profile(profile_dir: Path, downloads_dir: Path) -> None:
    """Escribe las preferencias de Chrome ANTES de abrirlo: descargar PDF en vez de mostrarlos."""
    default = profile_dir / "Default"
    default.mkdir(parents=True, exist_ok=True)
    prefs_path = default / "Preferences"
    prefs: dict[str, Any] = {}
    if prefs_path.exists():
        try:
            prefs = json.loads(prefs_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            prefs = {}
    prefs.setdefault("plugins", {})["always_open_pdf_externally"] = True
    download = prefs.setdefault("download", {})
    download["prompt_for_download"] = False
    download["default_directory"] = str(downloads_dir)
    prefs.setdefault("profile", {})["exit_type"] = "Normal"  # evita el aviso "Chrome no se cerró bien"
    prefs_path.write_text(json.dumps(prefs), encoding="utf-8")


def _subst(text: str | None, variables: dict[str, str]) -> str | None:
    if text is None:
        return None
    for k, v in variables.items():
        text = text.replace("{" + k + "}", v)
    return text


class PanelSession:
    def __init__(
        self,
        get_config: Callable[[], PanelConfig | None],
        profile_dir: Path,
        downloads_dir: Path,
        *,
        channel: str = "chrome",
        headless: bool = False,
    ):
        self._get_config = get_config
        self.profile_dir = profile_dir
        self.downloads_dir = downloads_dir
        self.channel = channel
        self.headless = headless
        self.state = "ok"  # ok | needs_login | paused | disabled
        self._pw = None
        self._ctx = None
        self._page = None

    # ---- ciclo de vida
    def _ensure_open(self):
        if self._page is not None:
            try:
                self._page.title()
                return self._page
            except Exception:
                self.close()
        from playwright.sync_api import sync_playwright

        prepare_profile(self.profile_dir, self.downloads_dir)
        self._pw = sync_playwright().start()
        self._ctx = self._pw.chromium.launch_persistent_context(
            str(self.profile_dir),
            channel=self.channel,
            headless=self.headless,
            accept_downloads=True,
            downloads_path=str(self.downloads_dir),
            no_viewport=True,
            ignore_default_args=["--enable-automation"],
        )
        self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self._page

    def close(self) -> None:
        for closer in (lambda: self._ctx and self._ctx.close(), lambda: self._pw and self._pw.stop()):
            try:
                closer()
            except Exception:
                pass
        self._ctx = self._pw = self._page = None

    def screenshot(self) -> bytes | None:
        try:
            if self._page is None:
                return None
            return self._page.screenshot(type="png")
        except Exception:
            return None

    # ---- detección
    def _blocked_reason(self, page, cfg: PanelConfig) -> str | None:
        for sel in cfg.challenge_selectors:
            try:
                if page.locator(sel).first.is_visible():
                    return "reto de verificación (Cloudflare)"
            except Exception:
                continue
        try:
            title = page.title()
        except Exception:
            title = ""
        for pattern in cfg.challenge_title_patterns:
            try:
                if re.search(pattern, title, re.IGNORECASE):
                    return "reto de verificación (Cloudflare)"
            except re.error:
                continue
        for sel in cfg.logged_out_selectors:
            try:
                if page.locator(sel).first.is_visible():
                    return "sesión cerrada en el panel"
            except Exception:
                continue
        return None

    def check_session(self) -> bool:
        """Abre el panel y confirma que la sesión sirve. Actualiza `state`."""
        cfg = self._get_config()
        if cfg is None:
            self.state = "disabled"
            return False
        try:
            page = self._ensure_open()
            page.goto(cfg.base_url, wait_until="domcontentloaded", timeout=45000)
            if cfg.logged_in_selector:
                try:
                    page.wait_for_selector(cfg.logged_in_selector, state="visible", timeout=10000)
                except Exception:
                    pass
            reason = self._blocked_reason(page, cfg)
            if reason is None and cfg.logged_in_selector and not page.locator(cfg.logged_in_selector).first.is_visible():
                reason = "no se ve la sesión iniciada"
            if reason:
                log.warning("Modo panel en pausa: %s", reason)
                self.state = "needs_login"
                return False
            self.state = "ok"
            return True
        except Exception as exc:
            log.warning("No pude abrir el panel (%s)", type(exc).__name__)
            self.state = "needs_login"
            self.close()
            return False

    # ---- pasos
    def run_step(self, name: str, variables: dict[str, str], download_to: Path | None = None) -> Path | None:
        """Ejecuta el paso `name` de la configuración remota. Devuelve la ruta del PDF si hubo descarga."""
        cfg = self._get_config()
        if cfg is None:
            raise PanelError("El panel no está configurado en el servidor")
        step = cfg.step(name)
        if step is None:
            raise PanelError(f"El paso '{name}' no está activo en la configuración")
        page = self._ensure_open()
        downloaded: Path | None = None
        try:
            for action in step.actions:
                result = self._do(page, cfg, action, variables, download_to)
                if result is not None:
                    downloaded = result
            blocked = self._blocked_reason(page, cfg)
            if blocked:
                raise NeedsLogin(f"El panel pide intervención: {blocked}", self.screenshot())
        except NeedsLogin as exc:
            self.state = "needs_login"
            raise exc
        except PanelError as exc:
            if exc.screenshot is None:
                exc.screenshot = self.screenshot()
            raise
        except Exception as exc:
            shot = self.screenshot()
            blocked = None
            try:
                blocked = self._blocked_reason(page, cfg)
            except Exception:
                pass
            if blocked:
                self.state = "needs_login"
                raise NeedsLogin(f"El panel pide intervención: {blocked}", shot) from exc
            raise PanelError(f"Falló el paso '{name}' ({type(exc).__name__}: {str(exc)[:200]})", shot) from exc
        return downloaded

    def _allowed_url(self, cfg: PanelConfig, url: str) -> str:
        base = urlparse(cfg.base_url)
        u = urlparse(url)
        if u.hostname != base.hostname:
            raise PanelError("Dirección fuera del panel configurado")
        return url

    def _do(self, page, cfg: PanelConfig, a: PanelAction, variables: dict[str, str], download_to: Path | None) -> Path | None:
        sel = _subst(a.selector, variables)
        val = _subst(a.value, variables)
        url = _subst(a.url, variables)
        if a.op == "goto":
            page.goto(self._allowed_url(cfg, url or cfg.base_url), wait_until="domcontentloaded", timeout=a.timeout_ms)
        elif a.op == "click":
            page.locator(sel or "").first.click(timeout=a.timeout_ms)
        elif a.op == "fill":
            page.locator(sel or "").first.fill(val or "", timeout=a.timeout_ms)
        elif a.op == "press":
            page.locator(sel or "body").first.press(val or "Enter", timeout=a.timeout_ms)
        elif a.op == "select_option":
            page.locator(sel or "").first.select_option(val or "", timeout=a.timeout_ms)
        elif a.op == "wait_for":
            page.wait_for_selector(sel or "", state=a.state, timeout=a.timeout_ms)
        elif a.op == "wait_ms":
            page.wait_for_timeout(min(a.timeout_ms, 10000))
        elif a.op == "expect_text":
            text = page.locator(sel or "body").first.inner_text(timeout=a.timeout_ms)
            if (val or "") not in text:
                raise PanelError(f"No apareció el texto esperado en {sel or 'la página'}")
        elif a.op == "download":
            target = download_to or (self.downloads_dir / "descarga.pdf")
            with page.expect_download(timeout=a.timeout_ms) as info:
                if url:
                    try:
                        page.goto(self._allowed_url(cfg, url), timeout=a.timeout_ms)
                    except Exception:
                        pass  # goto a un PDF que se descarga termina con "Download is starting"
                else:
                    page.locator(sel or "").first.click(timeout=a.timeout_ms)
            info.value.save_as(str(target))
            return target
        return None


def interactive_login(url: str, profile_dir: Path, downloads_dir: Path, channel: str = "chrome") -> None:
    """Abre Chrome con el perfil dedicado para que la persona inicie sesión una vez. Espera a que cierre la ventana."""
    from playwright.sync_api import sync_playwright

    prepare_profile(profile_dir, downloads_dir)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            str(profile_dir), channel=channel, headless=False, no_viewport=True, ignore_default_args=["--enable-automation"]
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception:
            pass
        try:
            ctx.wait_for_event("close", timeout=0)
        except Exception:
            pass
