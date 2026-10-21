"""Modo panel. Las pruebas con navegador usan Google Chrome real (headless) contra un "panel" falso local."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from izao_agent.config import PanelConfig, parse_remote
from izao_agent.panel import NeedsLogin, PanelError, PanelSession, prepare_profile

from .conftest import Rig, prints_in

CHROME = Path("C:/Program Files/Google/Chrome/Application/chrome.exe")
needs_chrome = pytest.mark.skipif(not CHROME.exists(), reason="Google Chrome no está instalado")


def panel_cfg(server, base_path="/panel/orders", steps=None):
    base = f"{server.url}/panel/orders"
    return {
        "base_url": server.url + base_path,
        "logged_in_selector": "#menu",
        "logged_out_selectors": ["#login"],
        "challenge_selectors": ["#challenge-form"],
        "challenge_title_patterns": ["Un momento"],
        "steps": steps if steps is not None else [{
            "name": "obtener_guia",
            "actions": [
                {"op": "goto", "url": base},
                {"op": "fill", "selector": "#buscar", "value": "{order_number}"},
                {"op": "click", "selector": "#ir"},
                {"op": "expect_text", "selector": "#res", "value": "{order_number}"},
                {"op": "download", "selector": "#guia", "timeout_ms": 10000},
            ],
        }],
    }


def test_prepare_profile_descarga_pdf_en_vez_de_abrirlos(tmp_path):
    prepare_profile(tmp_path / "perfil", tmp_path / "descargas")
    prefs = json.loads((tmp_path / "perfil" / "Default" / "Preferences").read_text(encoding="utf-8"))
    assert prefs["plugins"]["always_open_pdf_externally"] is True
    assert prefs["download"]["prompt_for_download"] is False
    # respeta preferencias existentes
    prefs["foo"] = 1
    (tmp_path / "perfil" / "Default" / "Preferences").write_text(json.dumps(prefs), encoding="utf-8")
    prepare_profile(tmp_path / "perfil", tmp_path / "descargas")
    again = json.loads((tmp_path / "perfil" / "Default" / "Preferences").read_text(encoding="utf-8"))
    assert again["foo"] == 1 and again["plugins"]["always_open_pdf_externally"] is True


def test_el_codigo_no_trae_selectores_ni_urls_de_panel():
    import ast

    arbol = ast.parse((Path(__file__).parents[1] / "izao_agent" / "panel.py").read_text(encoding="utf-8"))
    docstrings = {id(n.body[0].value) for n in ast.walk(arbol) if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef))
                  and n.body and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
    textos = [n.value for n in ast.walk(arbol) if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings]
    assert not [t for t in textos if t.startswith(("#", ".", "[", "http")) or "mastershop" in t.lower()]


@pytest.fixture
def sesion(tmp_path, server):
    holder = {"cfg": PanelConfig.model_validate(panel_cfg(server))}
    s = PanelSession(lambda: holder["cfg"], tmp_path / "perfil", tmp_path / "descargas", headless=True)
    s.holder = holder
    yield s
    s.close()


@needs_chrome
def test_sesion_activa_y_descarga_de_guia(sesion, tmp_path):
    assert sesion.check_session() is True and sesion.state == "ok"
    destino = tmp_path / "descargas" / "j1.pdf"
    got = sesion.run_step("obtener_guia", {"order_number": "IZ-CO-000123", "job_id": "j1"}, download_to=destino)
    assert got == destino and destino.read_bytes().startswith(b"%PDF-")


@needs_chrome
def test_sesion_perdida_pide_login(sesion, server):
    sesion.holder["cfg"] = PanelConfig.model_validate(panel_cfg(server, "/panel/login"))
    assert sesion.check_session() is False and sesion.state == "needs_login"


@needs_chrome
def test_reto_de_cloudflare_pausa(sesion, server):
    sesion.holder["cfg"] = PanelConfig.model_validate(panel_cfg(server, "/panel/challenge"))
    assert sesion.check_session() is False and sesion.state == "needs_login"


@needs_chrome
def test_fallo_de_paso_trae_captura(sesion, server):
    cfg = panel_cfg(server, steps=[{"name": "obtener_guia", "actions": [
        {"op": "goto", "url": server.url + "/panel/orders"}, {"op": "click", "selector": "#no-existe", "timeout_ms": 500}]}])
    sesion.holder["cfg"] = PanelConfig.model_validate(cfg)
    with pytest.raises(PanelError) as e:
        sesion.run_step("obtener_guia", {"order_number": "x", "job_id": "j"})
    assert e.value.screenshot and e.value.screenshot.startswith(b"\x89PNG")


@needs_chrome
def test_paso_fuera_del_panel_se_rechaza(sesion, server):
    cfg = panel_cfg(server, steps=[{"name": "obtener_guia", "actions": [{"op": "goto", "url": "https://otro-sitio.example.com/"}]}])
    sesion.holder["cfg"] = PanelConfig.model_validate(cfg)
    with pytest.raises(PanelError, match="fuera del panel"):
        sesion.run_step("obtener_guia", {"order_number": "x", "job_id": "j"})


# ------------------------------------------------------------------ agente en modo panel


@needs_chrome
def test_agente_modo_panel_imprime_con_sumatra_el_pdf_del_panel(tmp_path, server, sumatra_log):
    server.state.mode = "panel"
    server.state.panel_cfg = panel_cfg(server)
    r = Rig(tmp_path, server)
    holder = {}
    panel = PanelSession(lambda: holder["a"].remote.panel if holder["a"].remote else None, tmp_path / "perfil", tmp_path / "labels", headless=True)
    agent = r.new_agent(panel=panel)
    holder["a"] = agent
    try:
        agent.refresh_config()
        assert agent.mode == "panel"
        server.state.add_job("job-1", "IZ-CO-000123")
        assert agent.work_once() == 1
        calls = prints_in(sumatra_log)
        assert len(calls) == 1 and calls[0][-1].endswith("job-1.pdf")
        assert server.state.results[0]["status"] == "printed"
        agent.heartbeat_once()
        assert server.state.heartbeats[-1]["panel_state"] == "ok"
    finally:
        panel.close()


@needs_chrome
def test_agente_modo_panel_sin_sesion_no_reclama(tmp_path, server, sumatra_log):
    server.state.mode = "panel"
    server.state.panel_cfg = panel_cfg(server, "/panel/challenge")
    r = Rig(tmp_path, server)
    holder = {}
    panel = PanelSession(lambda: holder["a"].remote.panel if holder["a"].remote else None, tmp_path / "perfil", tmp_path / "labels", headless=True)
    agent = r.new_agent(panel=panel)
    holder["a"] = agent
    try:
        agent.refresh_config()
        server.state.add_job("job-1")
        agent.work_once()
        assert server.state.jobs["job-1"]["status"] == "queued" and prints_in(sumatra_log) == []
        agent.heartbeat_once()
        hb = server.state.heartbeats[-1]
        assert hb["panel_state"] == "needs_login" and "inicies sesión en MasterShop" in hb["last_error"]
    finally:
        panel.close()


@needs_chrome
def test_agente_modo_panel_tres_fallos_son_failed_con_captura(tmp_path, server, sumatra_log):
    server.state.mode = "panel"
    server.state.panel_cfg = panel_cfg(server, steps=[{"name": "obtener_guia", "actions": [
        {"op": "goto", "url": server.url + "/panel/orders"}, {"op": "click", "selector": "#no-existe", "timeout_ms": 300}]}])
    r = Rig(tmp_path, server)
    holder = {}
    panel = PanelSession(lambda: holder["a"].remote.panel if holder["a"].remote else None, tmp_path / "perfil", tmp_path / "labels", headless=True)
    agent = r.new_agent(panel=panel)
    holder["a"] = agent
    try:
        agent.refresh_config()
        server.state.add_job("job-1")
        for _ in range(3):
            agent.work_once()
        assert prints_in(sumatra_log) == []
        res = server.state.results[0]
        assert res["status"] == "failed" and res["shot"] is True and "3 intentos" in res["error"]
    finally:
        panel.close()
