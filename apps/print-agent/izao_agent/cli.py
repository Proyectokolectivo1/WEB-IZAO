"""Línea de comandos de `izao-agent.exe`.

  run          Ejecuta el agente (lo usa el vigilante).
  supervisor   Ejecuta el vigilante que reinicia al agente (lo usa la Tarea Programada).
  set-token    Guarda el token en el Administrador de credenciales de Windows.
  doctor       Revisa la instalación y dice, en español, qué falta.
  test-print   Imprime una página de prueba local en la impresora configurada.
  panel-login  Abre Chrome con el perfil dedicado para iniciar sesión en MasterShop (modo panel).
  forget-token Borra el token guardado.
  stop         Pide al vigilante y al agente que se detengan.
  version      Muestra la versión.
"""

from __future__ import annotations

import argparse
import getpass
import logging
import signal
import sys
import threading
from pathlib import Path

from . import __version__, paths
from .config import ConfigError, LocalConfig, load_local_config
from .logging_setup import register_secret, setup_logging
from .secrets import TokenError, get_token, set_token

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_CONFIG = 78


def _load(args) -> LocalConfig:
    path = Path(args.config) if getattr(args, "config", None) else paths.default_config_path()
    return load_local_config(path)


def _sumatra(cfg: LocalConfig) -> Path:
    return Path(cfg.sumatra_path) if cfg.sumatra_path else paths.default_sumatra_path()


def build_agent(cfg: LocalConfig):
    from .agent import Agent
    from .api import AgentApi
    from .panel import PanelSession
    from .printer import PrintService
    from .store import Store

    token = get_token()
    register_secret(token)
    api = AgentApi(cfg.server_url, lambda: token, timeout=cfg.http_timeout_seconds)
    store = Store(paths.db_path())
    printer = PrintService(_sumatra(cfg), cfg.printer, cfg.print_timeout_seconds)
    agent_ref: dict = {}
    panel = PanelSession(
        lambda: agent_ref["agent"].remote.panel if agent_ref["agent"].remote else None,
        paths.chrome_profile_dir(),
        paths.labels_dir(),
        channel=cfg.chrome_channel,
    )
    agent = Agent(
        cfg, api, store, printer,
        labels_dir=paths.labels_dir(), screenshots_dir=paths.screenshots_dir(),
        panel=panel, alive_path=paths.alive_file(),
    )
    agent_ref["agent"] = agent
    return agent


def _hide_console() -> None:
    """Oculta la ventana negra cuando el agente corre en segundo plano (Windows)."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        pass


def cmd_run(args) -> int:
    from .singleton import AlreadyRunning, FileLock

    if not args.console:
        _hide_console()

    try:
        cfg = _load(args)
    except ConfigError as exc:
        setup_logging(paths.logs_dir(), "INFO", console=True)
        logging.getLogger("izao").error("%s", exc)
        return EXIT_CONFIG
    setup_logging(paths.logs_dir(), cfg.log_level, console=args.console)
    log = logging.getLogger("izao")
    lock = FileLock(paths.data_dir() / "agent.lock")
    try:
        lock.acquire()
    except AlreadyRunning:
        log.error("Ya hay otro agente en marcha en este PC.")
        return EXIT_ERROR
    try:
        try:
            agent = build_agent(cfg)
        except TokenError as exc:
            log.error("%s", exc)
            return EXIT_CONFIG
        paths.stop_flag().unlink(missing_ok=True)
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, lambda *_: stop.set())
            except (ValueError, OSError):
                pass
        t = threading.Thread(target=agent.run, args=(stop,), name="agente")
        t.start()
        while t.is_alive():
            t.join(timeout=2)
            if paths.stop_flag().exists():
                stop.set()
        return EXIT_OK
    finally:
        lock.release()


def cmd_supervisor(args) -> int:
    from .singleton import AlreadyRunning, FileLock
    from .supervisor import agent_command, supervise

    if not args.console:
        _hide_console()
    setup_logging(paths.logs_dir(), "INFO", console=args.console, name="vigilante")
    lock = FileLock(paths.data_dir() / "supervisor.lock")
    try:
        lock.acquire()
    except AlreadyRunning:
        logging.getLogger("izao").error("El vigilante ya está en marcha.")
        return EXIT_ERROR
    try:
        paths.stop_flag().unlink(missing_ok=True)
        cfg_path = Path(args.config) if args.config else None
        supervise(agent_command(cfg_path), stop_flag=paths.stop_flag(), alive_file=paths.alive_file())
        paths.stop_flag().unlink(missing_ok=True)
        return EXIT_OK
    finally:
        lock.release()


def cmd_set_token(args) -> int:
    if args.stdin:
        token = sys.stdin.readline().strip()
    else:
        token = getpass.getpass("Pegue el token del agente (no se verá al escribir): ").strip()
    try:
        set_token(token)
    except TokenError as exc:
        print(f"ERROR: {exc}")
        return EXIT_ERROR
    print("Listo: el token quedó guardado en el Administrador de credenciales de Windows.")
    return EXIT_OK


def cmd_doctor(args) -> int:
    ok_all = True

    def line(ok: bool | None, text: str) -> None:
        nonlocal ok_all
        mark = {True: "[ OK ]", False: "[FALTA]", None: "[ AVISO ]"}[ok]
        if ok is False:
            ok_all = False
        print(f"{mark} {text}")

    line(True, f"Versión del agente: {__version__}")
    try:
        cfg = _load(args)
        line(True, f"Configuración leída. Servidor: {cfg.server_url}")
    except ConfigError as exc:
        line(False, str(exc))
        return EXIT_CONFIG
    sumatra = _sumatra(cfg)
    line(sumatra.exists(), f"SumatraPDF: {sumatra}" + ("" if sumatra.exists() else "  (no está; copie SumatraPDF.exe a esa carpeta)"))
    from .printer import PrintService, list_printers

    names = list_printers()
    if not cfg.printer:
        line(False, "No hay impresora elegida en config.yaml (campo 'printer'). Impresoras instaladas: " + (", ".join(names) or "ninguna"))
    else:
        found = PrintService(sumatra, cfg.printer, lister=lambda: names).printer_available()
        line(found, f"Impresora '{cfg.printer}'" + ("" if found else ". Instaladas: " + (", ".join(names) or "ninguna")))
    try:
        token = get_token()
        register_secret(token)
        line(True, "Token guardado en el Administrador de credenciales.")
    except TokenError as exc:
        line(False, str(exc))
        return EXIT_CONFIG
    from .api import AgentApi, ApiError

    api = AgentApi(cfg.server_url, lambda: token, timeout=cfg.http_timeout_seconds, long_attempts=1, short_attempts=1)
    try:
        data = api.get_config()
        line(True, f"El servidor responde y acepta el token (modo: {data.get('agent', {}).get('mode', '?')}).")
    except ApiError as exc:
        line(False, f"No pude hablar con el servidor: {exc}")
    finally:
        api.close()
    try:
        probe = paths.labels_dir() / ".prueba"
        probe.write_text("ok")
        probe.unlink()
        line(True, f"Carpeta de datos escribible: {paths.data_dir()}")
    except OSError as exc:
        line(False, f"No puedo escribir en {paths.data_dir()}: {exc}")
    print("\nTodo bien." if ok_all else "\nHay cosas por corregir (las marcadas FALTA).")
    return EXIT_OK if ok_all else EXIT_ERROR


def cmd_test_print(args) -> int:
    from .printer import PrintService
    from .testpdf import build_test_pdf

    cfg = _load(args)
    pdf = paths.labels_dir() / "prueba-local.pdf"
    pdf.write_bytes(build_test_pdf())
    svc = PrintService(_sumatra(cfg), cfg.printer, cfg.print_timeout_seconds)
    if not svc.printer_available():
        print(f"ERROR: no encuentro la impresora '{cfg.printer}'.")
        return EXIT_ERROR
    out = svc.print_pdf(pdf, cfg.print_settings)
    print("Página de prueba enviada a la impresora." if out.ok else f"ERROR: {out.error}")
    return EXIT_OK if out.ok else EXIT_ERROR


def cmd_panel_login(args) -> int:
    from .api import AgentApi, ApiError
    from .config import parse_remote
    from .panel import interactive_login

    cfg = _load(args)
    url = args.url
    if not url:
        token = get_token()
        register_secret(token)
        api = AgentApi(cfg.server_url, lambda: token, timeout=cfg.http_timeout_seconds, long_attempts=1, short_attempts=1)
        try:
            remote = parse_remote(api.get_config())
            url = remote.panel.base_url if remote.panel else None
        except ApiError as exc:
            print(f"No pude leer la dirección del panel desde el servidor: {exc}")
        finally:
            api.close()
    if not url:
        print("Indique la dirección del panel con --url https://... (el servidor aún no la tiene configurada).")
        return EXIT_ERROR
    print("Se abrirá Chrome. Inicie sesión, resuelva la verificación si aparece y luego CIERRE la ventana de Chrome.")
    interactive_login(url, paths.chrome_profile_dir(), paths.labels_dir(), cfg.chrome_channel)
    print("Listo. Sesión guardada en el perfil dedicado del agente.")
    return EXIT_OK


def cmd_forget_token(_args) -> int:
    from .secrets import delete_token

    delete_token()
    print("El token se borró del Administrador de credenciales.")
    return EXIT_OK


def cmd_stop(_args) -> int:
    paths.stop_flag().write_text("stop")
    print("Pedí que el agente se detenga (tarda unos segundos).")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="izao-agent", description="Agente de impresión de Izao Perfumería")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, fn, helptext in (
        ("run", cmd_run, "ejecuta el agente"),
        ("supervisor", cmd_supervisor, "ejecuta el vigilante"),
        ("doctor", cmd_doctor, "revisa la instalación"),
        ("test-print", cmd_test_print, "imprime una página de prueba local"),
        ("panel-login", cmd_panel_login, "abre Chrome para iniciar sesión en MasterShop"),
        ("set-token", cmd_set_token, "guarda el token"),
        ("forget-token", cmd_forget_token, "borra el token guardado"),
        ("stop", cmd_stop, "detiene el agente"),
    ):
        sp = sub.add_parser(name, help=helptext)
        sp.set_defaults(func=fn)
        if name not in ("stop", "set-token", "forget-token"):
            sp.add_argument("--config", help="ruta de config.yaml")
        if name in ("run", "supervisor"):
            sp.add_argument("--console", action="store_true", help="mostrar el log en pantalla")
        if name == "set-token":
            sp.add_argument("--stdin", action="store_true", help="leer el token desde la entrada estándar")
        if name == "panel-login":
            sp.add_argument("--url", help="dirección del panel (si no, se pide al servidor)")
    v = sub.add_parser("version", help="muestra la versión")
    v.set_defaults(func=lambda _a: (print(f"izao-agent {__version__}"), EXIT_OK)[1])
    return p


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # acentos correctos también cuando la salida va por una tubería (instalador)
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    args = build_parser().parse_args(argv)
    return int(args.func(args))
