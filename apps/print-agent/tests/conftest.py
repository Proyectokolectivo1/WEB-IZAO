from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from izao_agent.agent import Agent
from izao_agent.api import AgentApi
from izao_agent.config import LocalConfig
from izao_agent.printer import PrintService
from izao_agent.store import Store

from .fake_server import TOKEN, FakeServer

FAKE_SUMATRA = Path(__file__).with_name("fake_sumatra.py")


@pytest.fixture
def server():
    s = FakeServer().start()
    yield s
    s.stop()


@pytest.fixture
def sumatra_log(tmp_path, monkeypatch):
    log = tmp_path / "sumatra.log"
    monkeypatch.setenv("FAKE_SUMATRA_LOG", str(log))
    monkeypatch.delenv("FAKE_SUMATRA_EXITS", raising=False)
    monkeypatch.delenv("FAKE_SUMATRA_SLEEP", raising=False)
    return log


def prints_in(log: Path) -> list[list[str]]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]


class Rig:
    """Un agente armado contra el servidor falso. `new_agent()` simula un reinicio (misma base SQLite)."""

    def __init__(self, tmp_path: Path, server: FakeServer, printers=("Zebra Test",), **cfg_overrides):
        self.tmp = tmp_path
        self.server = server
        self.printers = list(printers)
        self.cfg = LocalConfig(server_url=server.url, printer="Zebra Test", print_settings="noscale", **cfg_overrides)
        (tmp_path / "labels").mkdir(exist_ok=True)
        (tmp_path / "shots").mkdir(exist_ok=True)
        self.agent = self.new_agent()

    def new_agent(self, printer_cls=PrintService, panel=None) -> Agent:
        api = AgentApi(self.server.url, lambda: TOKEN, timeout=5, sleep=lambda s: None, wait_initial=0.001, wait_max=0.002)
        store = Store(self.tmp / "agent.db")
        printer = printer_cls(
            "SumatraPDF.exe", self.cfg.printer, 10,
            command_prefix=[sys.executable, str(FAKE_SUMATRA)], lister=lambda: self.printers,
        )
        self.agent = Agent(
            self.cfg, api, store, printer,
            labels_dir=self.tmp / "labels", screenshots_dir=self.tmp / "shots",
            panel=panel, alive_path=self.tmp / "alive", sleep=lambda s: None, retry_delay=0,
        )
        return self.agent


@pytest.fixture
def rig(tmp_path, server, sumatra_log):
    return Rig(tmp_path, server)
