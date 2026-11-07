"""Contrato 1.1 (D-051): descarga directa del CDN. HTTP simulado con httpx.MockTransport: sin red real ni impresion real."""
from __future__ import annotations

import sqlite3
import sys

import httpx
import pytest

from izao_agent.agent import Agent
from izao_agent.api import AgentApi, ClaimedJob, PermanentError, TransientError, validate_label_url
from izao_agent.config import LocalConfig, parse_remote
from izao_agent.printer import PrintService
from izao_agent.store import Store
from izao_agent.testpdf import build_test_pdf

from .conftest import FAKE_SUMATRA, prints_in
from .fake_server import TOKEN

URL = "https://cdn.bemaster.com/labels/abc123.pdf?sig=SECRETO-FIRMADO"
PDF = build_test_pdf("IZ-CO-000777")
BIG = b"%PDF-" + b"0" * (10 * 1024 * 1024 + 1)


class Cdn:
    """Transporte simulado: registra las peticiones y responde con lo configurado."""

    def __init__(self, handler=None):
        self.requests: list[httpx.Request] = []
        self.handler = handler or (lambda req: httpx.Response(200, content=PDF, headers={"content-type": "application/pdf"}))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self), follow_redirects=False)


def make_api(cdn: Cdn, base: str = "http://127.0.0.1:1") -> AgentApi:
    return AgentApi(base, lambda: TOKEN, sleep=lambda s: None, wait_initial=0.001, wait_max=0.002, cdn_client=cdn.client())


# ------------------------------------------------------------------ validacion de la URL
@pytest.mark.parametrize(
    "url",
    [
        "http://cdn.bemaster.com/a.pdf",
        "https://cdn.bemaster.com:8443/a.pdf",
        "https://evil.example.com/a.pdf",
        "https://cdn.bemaster.com.evil.com/a.pdf",
        "https://evilcdn.bemaster.com/a.pdf",
        "https://cdn.bemaster.com@evil.com/a.pdf",
        "https://user:pw@cdn.bemaster.com/a.pdf",
        "ftp://cdn.bemaster.com/a.pdf",
        "",
    ],
)
def test_url_no_permitida(url):
    with pytest.raises(PermanentError) as e:
        validate_label_url(url)
    assert e.value.code == "url_no_permitida"


def test_url_valida_puerto_443_explicito():
    assert validate_label_url("https://cdn.bemaster.com:443/a.pdf") == "https://cdn.bemaster.com:443/a.pdf"


# ------------------------------------------------------------------ cliente
def test_descarga_valida_sin_authorization():
    cdn = Cdn()
    assert make_api(cdn).download_label_url(URL) == PDF
    assert len(cdn.requests) == 1
    req = cdn.requests[0]
    assert "authorization" not in req.headers and TOKEN not in str(req.headers)
    assert req.headers["user-agent"].startswith("IzaoAgent/")
    assert req.url.host == "cdn.bemaster.com"


@pytest.mark.parametrize("url", ["https://evil.example.com/a.pdf", "http://cdn.bemaster.com/a.pdf"])
def test_host_ajeno_o_http_no_hacen_peticion(url):
    cdn = Cdn()
    with pytest.raises(PermanentError):
        make_api(cdn).download_label_url(url)
    assert cdn.requests == []


def test_redireccion_a_otro_host_no_se_sigue():
    cdn = Cdn(lambda req: httpx.Response(302, headers={"location": "https://evil.example.com/x.pdf"}))
    with pytest.raises(PermanentError) as e:
        make_api(cdn).download_label_url(URL)
    assert e.value.code == "redireccion_no_permitida"
    assert [r.url.host for r in cdn.requests] == ["cdn.bemaster.com"]


def test_no_es_pdf():
    cdn = Cdn(lambda req: httpx.Response(200, content=b"<html>Acceso denegado</html>"))
    with pytest.raises(PermanentError) as e:
        make_api(cdn).download_label_url(URL)
    assert e.value.code == "no_es_pdf"


def test_tamano_excedido_por_cabecera_y_por_cuerpo():
    for resp in (
        httpx.Response(200, content=b"%PDF-1", headers={"content-length": str(len(BIG))}),
        httpx.Response(200, content=BIG),
    ):
        with pytest.raises(PermanentError) as e:
            make_api(Cdn(lambda req, r=resp: r)).download_label_url(URL)
        assert e.value.code == "muy_grande"


def test_403_es_rechazo():
    cdn = Cdn(lambda req: httpx.Response(403, content=b"Forbidden"))
    with pytest.raises(PermanentError) as e:
        make_api(cdn).download_label_url(URL)
    assert (e.value.status, e.value.code) == (403, "cdn_rechazo")
    assert len(cdn.requests) == 1


def test_5xx_y_red_reintentan_con_espera():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        if calls["n"] == 2:
            raise httpx.ConnectError("caida")
        return httpx.Response(200, content=PDF)

    assert make_api(Cdn(handler)).download_label_url(URL) == PDF
    assert calls["n"] == 3

    always = Cdn(lambda req: httpx.Response(502))
    with pytest.raises(TransientError):
        make_api(always).download_label_url(URL)
    assert len(always.requests) == 3


# ------------------------------------------------------------------ agente completo (servidor falso + CDN simulado)
def build_agent(tmp_path, server, cdn: Cdn, **cfg) -> Agent:
    api = AgentApi(server.url, lambda: TOKEN, timeout=5, sleep=lambda s: None, wait_initial=0.001, wait_max=0.002, cdn_client=cdn.client())
    (tmp_path / "labels").mkdir(exist_ok=True)
    (tmp_path / "shots").mkdir(exist_ok=True)
    printer = PrintService(
        "SumatraPDF.exe", "Zebra Test", 10, command_prefix=[sys.executable, str(FAKE_SUMATRA)], lister=lambda: ["Zebra Test"]
    )
    return Agent(
        LocalConfig(server_url=server.url, printer="Zebra Test", print_settings="noscale", **cfg),
        api, Store(tmp_path / "agent.db"), printer,
        labels_dir=tmp_path / "labels", screenshots_dir=tmp_path / "shots",
        alive_path=tmp_path / "alive", sleep=lambda s: None, retry_delay=0,
    )


def test_agente_imprime_desde_label_url_una_sola_vez(tmp_path, server, sumatra_log):
    cdn = Cdn()
    agent = build_agent(tmp_path, server, cdn)
    server.state.add_job("job-cdn", "IZ-CO-000777", label_url=URL)
    assert agent.work_once() == 1
    assert len(prints_in(sumatra_log)) == 1
    assert server.state.results[0]["status"] == "printed"
    assert all("authorization" not in r.headers for r in cdn.requests)
    assert ("GET", "/api/agent/jobs/job-cdn/label") not in server.state.requests
    agent.work_once()
    assert len(prints_in(sumatra_log)) == 1 and len(cdn.requests) == 1


def test_label_url_null_usa_el_flujo_normal(tmp_path, server, sumatra_log):
    cdn = Cdn()
    agent = build_agent(tmp_path, server, cdn)
    server.state.add_job("job-api", "IZ-CO-000001")
    assert agent.work_once() == 1
    assert cdn.requests == []
    assert ("GET", "/api/agent/jobs/job-api/label") in server.state.requests
    assert server.state.results[0]["status"] == "printed"


def test_servidor_1_0_sin_label_url_ni_revision():
    assert ClaimedJob.model_validate({"id": "j1", "type": "label"}).label_url is None
    assert parse_remote({"contract_version": 1, "config_version": "x"}).contract_revision is None
    assert parse_remote({"contract_version": 1, "contract_revision": "1.1"}).contract_revision == "1.1"


@pytest.mark.parametrize(
    "bad_url,handler",
    [
        ("https://evil.example.com/a.pdf", None),
        ("http://cdn.bemaster.com/a.pdf", None),
        (URL, lambda req: httpx.Response(302, headers={"location": "https://evil.example.com/x"})),
        (URL, lambda req: httpx.Response(200, content=b"no soy pdf")),
        (URL, lambda req: httpx.Response(200, content=BIG)),
        (URL, lambda req: httpx.Response(403)),
    ],
)
def test_fallos_terminan_en_failed_sin_imprimir_y_sin_secretos(tmp_path, server, sumatra_log, bad_url, handler):
    cdn = Cdn(handler)
    agent = build_agent(tmp_path, server, cdn)
    server.state.add_job("job-bad", "IZ-CO-000778", label_url=bad_url)
    for _ in range(5):
        agent.work_once()
    assert prints_in(sumatra_log) == []
    assert len(server.state.results) == 1
    res = server.state.results[0]
    assert res["status"] == "failed" and res["error"]
    assert "SECRETO" not in res["error"] and TOKEN not in res["error"] and "sig=" not in res["error"]
    assert all(r.url.host == "cdn.bemaster.com" for r in cdn.requests)


def test_403_se_reintenta_en_varios_ciclos_antes_de_fallar(tmp_path, server, sumatra_log):
    state = {"n": 0}

    def handler(req):
        state["n"] += 1
        return httpx.Response(403) if state["n"] < 3 else httpx.Response(200, content=PDF)

    agent = build_agent(tmp_path, server, Cdn(handler))
    server.state.add_job("job-flaky", "IZ-CO-000779", label_url=URL)
    for _ in range(4):
        agent.work_once()
    assert len(prints_in(sumatra_log)) == 1
    assert [r["status"] for r in server.state.results] == ["printed"]


def test_sin_red_no_falla_de_inmediato_y_se_recupera(tmp_path, server, sumatra_log):
    state = {"down": True}

    def handler(req):
        if state["down"]:
            raise httpx.ConnectError("sin internet")
        return httpx.Response(200, content=PDF)

    agent = build_agent(tmp_path, server, Cdn(handler))
    server.state.add_job("job-net", "IZ-CO-000780", label_url=URL)
    for _ in range(4):
        agent.work_once()
    assert server.state.results == [] and prints_in(sumatra_log) == []
    state["down"] = False
    agent.work_once()
    assert len(prints_in(sumatra_log)) == 1 and server.state.results[0]["status"] == "printed"


def test_label_url_sobrevive_a_un_reinicio(tmp_path, server, sumatra_log):
    state = {"down": True}

    def handler(req):
        if state["down"]:
            raise httpx.ConnectError("sin internet")
        return httpx.Response(200, content=PDF)

    server.state.add_job("job-rs", "IZ-CO-000781", label_url=URL)
    build_agent(tmp_path, server, Cdn(handler)).work_once()
    state["down"] = False
    nuevo = build_agent(tmp_path, server, Cdn(handler))  # reinicio: misma base SQLite
    nuevo.startup()
    nuevo.work_once()
    assert len(prints_in(sumatra_log)) == 1
    assert server.state.results[0]["status"] == "printed"


def test_base_de_la_version_1_0_se_migra(tmp_path):
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, order_number TEXT, reprint INTEGER NOT NULL DEFAULT 0,"
        "claimed_at TEXT, phase TEXT NOT NULL DEFAULT 'new', attempts INTEGER NOT NULL DEFAULT 0, pdf_path TEXT, result_status TEXT,"
        "result_error TEXT, screenshot_path TEXT, reported INTEGER NOT NULL DEFAULT 0, report_tries INTEGER NOT NULL DEFAULT 0,"
        "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, printed_at TEXT);"
    )
    con.close()
    row = Store(db).register("j1", "label", "IZ-CO-1", False, None, URL)
    assert row["label_url"] == URL
