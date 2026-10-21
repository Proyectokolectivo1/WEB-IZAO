"""Prueba de extremo a extremo: el agente real como proceso, contra el servidor falso y con SumatraPDF falso.

Solo LISTA las impresoras de Windows (para validar el nombre); no se imprime nada.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from izao_agent.printer import list_printers

from .conftest import prints_in
from .fake_server import TOKEN

_INSTALADAS = list_printers() if sys.platform == "win32" else []
# Preferida: la impresora virtual "Microsoft Print to PDF"; si no está habilitada se usa cualquiera (solo se LISTA).
IMPRESORA = "Microsoft Print to PDF" if "Microsoft Print to PDF" in _INSTALADAS else (_INSTALADAS[0] if _INSTALADAS else "")
pytestmark = pytest.mark.skipif(not IMPRESORA, reason="necesita Windows con al menos una impresora instalada")


def test_agente_como_proceso(server, tmp_path, sumatra_log):
    home = tmp_path / "datos"
    cfg = tmp_path / "config.yaml"
    stub = Path(__file__).with_name("fake_sumatra.cmd")
    cfg.write_text(
        f"server_url: {server.url}\nprinter: {IMPRESORA!r}\nsumatra_path: {str(stub)!r}\n"
        "intervals: {heartbeat_seconds: 5, claim_seconds: 2, panel_retry_seconds: 30}\n",
        encoding="utf-8",
    )
    server.state.intervals = {"heartbeat_seconds": 5, "claim_seconds": 2, "panel_retry_seconds": 30}
    server.state.add_job("job-e2e", "IZ-CO-000777")
    env = {**os.environ, "IZAO_AGENT_HOME": str(home), "IZAO_AGENT_TOKEN": TOKEN, "FAKE_PY": sys.executable}
    root = Path(__file__).parents[1]
    proc = subprocess.Popen([sys.executable, "-m", "izao_agent", "run", "--config", str(cfg)], cwd=root, env=env)
    try:
        limite = time.time() + 40
        while time.time() < limite and not (server.state.results and server.state.heartbeats):
            time.sleep(0.5)
        assert server.state.results and server.state.results[0]["status"] == "printed"
        assert len(prints_in(sumatra_log)) == 1
        assert server.state.heartbeats[0]["printer"] == IMPRESORA and server.state.heartbeats[0]["printer_ok"] is True
        # Segunda copia: el candado impide dos agentes a la vez
        dos = subprocess.run([sys.executable, "-m", "izao_agent", "run", "--config", str(cfg)], cwd=root, env=env, timeout=30)
        assert dos.returncode == 1
    finally:
        (home / "detener.flag").write_text("stop")
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
    assert proc.returncode == 0
    log = (home / "logs" / "agent.log").read_text(encoding="utf-8")
    assert "Agente 1.0.0 en marcha" in log and TOKEN not in log
