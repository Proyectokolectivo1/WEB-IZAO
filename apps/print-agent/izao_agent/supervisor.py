"""Vigilante (watchdog): lanza el agente y lo reinicia si se cae o se queda colgado.

Se ejecuta desde la Tarea Programada "al iniciar sesión". Si el agente sale con código 78 (configuración o token
incorrectos) espera más antes de reintentar para no llenar el log mientras la persona lo corrige.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from . import paths

log = logging.getLogger("izao.supervisor")

EXIT_CONFIG = 78
HANG_SECONDS = 600  # sin señal de vida durante 10 min = colgado (un trabajo largo toca la señal tras cada intento)
CONFIG_WAIT = 60


def agent_command(config_path: Path | None) -> list[str]:
    base = [sys.executable] if paths.is_frozen() else [sys.executable, "-m", "izao_agent"]
    cmd = [*base, "run"]
    if config_path:
        cmd += ["--config", str(config_path)]
    return cmd


def supervise(
    command: list[str],
    *,
    stop_flag: Path,
    alive_file: Path,
    hang_seconds: float = HANG_SECONDS,
    min_backoff: float = 5.0,
    max_backoff: float = 60.0,
    poll: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
    max_starts: int | None = None,
) -> int:
    """Devuelve el número de arranques hechos. Termina cuando aparece `stop_flag` (o `max_starts`, para pruebas)."""
    starts = 0
    backoff = min_backoff
    while not stop_flag.exists():
        if max_starts is not None and starts >= max_starts:
            break
        starts += 1
        log.info("Iniciando el agente (arranque %s)", starts)
        started = time.time()
        proc = subprocess.Popen(command, creationflags=0x08000000 if sys.platform == "win32" else 0)
        code: int | None = None
        while True:
            code = proc.poll()
            if code is not None:
                break
            if stop_flag.exists():
                _terminate(proc)
                return starts
            if _is_hung(alive_file, started, hang_seconds):
                log.error("El agente no da señales de vida; lo reinicio")
                _terminate(proc)
                code = -1
                break
            sleep(poll)
        ran = time.time() - started
        if code == EXIT_CONFIG:
            log.error("El agente se detuvo por un problema de configuración o token; espero %s s", CONFIG_WAIT)
            _wait(CONFIG_WAIT, stop_flag, sleep, poll)
            continue
        log.warning("El agente terminó (código %s) tras %.0f s", code, ran)
        backoff = min_backoff if ran > 300 else min(backoff * 2, max_backoff)
        _wait(backoff, stop_flag, sleep, poll)
    return starts


def _is_hung(alive_file: Path, started: float, hang_seconds: float) -> bool:
    now = time.time()
    try:
        last = alive_file.stat().st_mtime
    except OSError:
        last = started
    return now - max(last, started) > hang_seconds


def _wait(seconds: float, stop_flag: Path, sleep: Callable[[float], None], poll: float) -> None:
    waited = 0.0
    while waited < seconds and not stop_flag.exists():
        sleep(min(poll, seconds - waited))
        waited += poll


def _terminate(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)
