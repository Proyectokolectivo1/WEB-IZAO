from __future__ import annotations

import logging

import httpx
import pytest
from pydantic import ValidationError

from izao_agent.api import AgentApi, AuthError, PermanentError, TransientError
from izao_agent.config import ConfigError, LocalConfig, effective_print_settings, load_local_config, parse_remote
from izao_agent.logging_setup import redact, register_secret, setup_logging
from izao_agent.testpdf import build_test_pdf

from .fake_server import TOKEN


def _api(server, token=TOKEN, **kw):
    return AgentApi(server.url, lambda: token, sleep=lambda s: None, wait_initial=0.001, wait_max=0.002, **kw)


def test_reintenta_5xx_y_luego_funciona(server):
    server.state.fail["claim"] = [503, 500]
    assert _api(server, short_attempts=3).claim(5) == []
    assert sum(1 for m, p in server.state.requests if p.endswith("/claim")) == 3


def test_5xx_agota_reintentos(server):
    server.state.fail["claim"] = [503] * 5
    with pytest.raises(TransientError):
        _api(server, short_attempts=2).claim(5)


def test_401_y_4xx_no_se_reintentan(server):
    with pytest.raises(AuthError):
        _api(server, token="X" * 40).claim()
    server.state.fail["config"] = [404]
    with pytest.raises(PermanentError) as e:
        _api(server).get_config()
    assert e.value.status == 404
    assert sum(1 for m, p in server.state.requests if p.endswith("/config")) == 1


def test_501_es_definitivo(server):
    server.state.add_job("a", type_="packing_list")
    server.state.jobs["a"].update(status="claimed", agent="agent-1")
    with pytest.raises(PermanentError) as e:
        _api(server).download_label("a")
    assert e.value.status == 501


def test_red_caida_es_transitoria():
    def boom(request):
        raise httpx.ConnectTimeout("x")

    api = AgentApi("https://izaoperfumeria.com", lambda: TOKEN, client=httpx.Client(transport=httpx.MockTransport(boom)),
                   sleep=lambda s: None, wait_initial=0.001, wait_max=0.002)
    with pytest.raises(TransientError):
        api.heartbeat({"version": "1"})


def test_no_sigue_la_ruta_del_servidor_para_descargar():
    pedidos = []

    def handler(request):
        pedidos.append(str(request.url))
        return httpx.Response(200, content=b"%PDF-1.4")

    api = AgentApi("https://izaoperfumeria.com", lambda: TOKEN, client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert api.download_label("abc-123") == b"%PDF-1.4"
    assert pedidos == ["https://izaoperfumeria.com/api/agent/jobs/abc-123/label"]
    with pytest.raises(ValueError):
        api.download_label("../x")


def test_pdf_de_prueba_es_valido():
    pdf = build_test_pdf()
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")


# ------------------------------------------------------------------ configuración


def test_config_valida_y_errores_en_español(tmp_path):
    f = tmp_path / "config.yaml"
    f.write_text("server_url: https://izaoperfumeria.com\nprinter: Zebra\ncopies: 2\n", encoding="utf-8")
    cfg = load_local_config(f)
    assert cfg.copies == 2 and cfg.max_print_attempts == 3
    f.write_text("server_url: http://izaoperfumeria.com\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="https"):
        load_local_config(f)
    f.write_text("impresora: Zebra\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="impresora"):
        load_local_config(f)
    f.write_text("copies: [\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="formato"):
        load_local_config(f)
    with pytest.raises(ConfigError, match="No encuentro"):
        load_local_config(tmp_path / "nada.yaml")


def test_http_solo_en_este_pc():
    LocalConfig(server_url="http://127.0.0.1:8080")
    with pytest.raises(ValidationError):
        LocalConfig(server_url="http://192.168.1.5")
    with pytest.raises(ValidationError):
        LocalConfig(print_settings="noscale; calc.exe")


def test_ajustes_efectivos():
    local = LocalConfig(print_settings="noscale,3x", copies=1)
    assert effective_print_settings(local, None) == ("noscale", 1)
    remote = parse_remote({"print": {"copies": 2, "print_settings": "fit,paper=A6"}, "agent": {"mode": "api"}})
    assert effective_print_settings(local, remote) == ("fit,paper=A6,2x", 2)


def test_remota_panel_https_y_pasos():
    r = parse_remote({
        "contract_version": 1, "config_version": "9", "agent": {"mode": "panel"},
        "panel": {"base_url": "https://panel.example.com/orders", "steps": [{"name": "obtener_guia", "actions": [{"op": "click", "selector": "#x"}]}]},
    })
    assert r.mode == "panel" and r.panel.step("obtener_guia") is not None and r.panel.step("confirmar") is None
    with pytest.raises(ValidationError):
        parse_remote({"panel": {"base_url": "http://evil.example.com"}})
    with pytest.raises(ValidationError):
        parse_remote({"panel": {"base_url": "https://x.com", "steps": [{"name": "a", "actions": [{"op": "eval_js"}]}]}})


# ------------------------------------------------------------------ logs sin secretos


def test_redaccion():
    register_secret(TOKEN)
    assert TOKEN not in redact(f"token={TOKEN} y {TOKEN}")
    assert "abcdef" not in redact("Authorization: Bearer abcdef123456")
    assert "x" * 400 not in redact("captura " + "x" * 400)


def test_el_log_en_disco_no_contiene_el_token(tmp_path):
    register_secret(TOKEN)
    setup_logging(tmp_path, "DEBUG")
    log = logging.getLogger("izao.prueba")
    log.info("Llamando con Authorization: Bearer %s", TOKEN)
    log.info("Token crudo %s", TOKEN)
    try:
        raise RuntimeError(f"falló con {TOKEN}")
    except RuntimeError:
        log.exception("error")
    for h in logging.getLogger().handlers:
        h.flush()
    texto = (tmp_path / "agent.log").read_text(encoding="utf-8")
    assert "Llamando" in texto and TOKEN not in texto


def test_log_rotativo(tmp_path):
    from logging.handlers import RotatingFileHandler

    setup_logging(tmp_path, "INFO")
    assert any(isinstance(h, RotatingFileHandler) and h.backupCount >= 3 for h in logging.getLogger().handlers)


def test_token_valido_y_guardado(monkeypatch):
    from izao_agent import secrets

    guardado = {}

    class FakeKeyring:
        def set_password(self, s, a, v):
            guardado[(s, a)] = v

        def get_password(self, s, a):
            return guardado.get((s, a))

        def delete_password(self, s, a):
            guardado.pop((s, a), None)

    monkeypatch.setattr(secrets, "_keyring", lambda: FakeKeyring())
    monkeypatch.delenv(secrets.ENV_VAR, raising=False)
    with pytest.raises(secrets.TokenError):
        secrets.set_token("corto")
    with pytest.raises(secrets.TokenError):
        secrets.get_token()
    secrets.set_token(TOKEN)
    assert secrets.get_token() == TOKEN and secrets.has_token()
