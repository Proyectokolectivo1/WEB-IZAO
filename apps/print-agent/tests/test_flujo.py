"""Flujo completo contra el servidor falso, con SumatraPDF falso (no se imprime nada de verdad)."""
from __future__ import annotations

import pytest

from izao_agent.printer import PrintService
from izao_agent.store import INTERRUPTED_MESSAGE

from .conftest import Rig, prints_in
from .fake_server import FakeServer


def test_imprime_una_vez_y_avisa(rig, server, sumatra_log):
    server.state.add_job("job-1", "IZ-CO-000001")
    assert rig.agent.work_once() == 1
    calls = prints_in(sumatra_log)
    assert len(calls) == 1
    args = calls[0]
    assert args[:2] == ["-print-to", "Zebra Test"]
    assert "-print-settings" in args and args[args.index("-print-settings") + 1] == "noscale"
    assert "-silent" in args and args[-1].endswith("job-1.pdf")
    assert server.state.results == [{"id": "job-1", "status": "printed", "error": None, "attempts": 1, "shot": False, "dup": False}]
    # Otro ciclo: nada que imprimir ni que avisar
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 1 and len(server.state.results) == 1


def test_el_token_viaja_solo_en_la_cabecera(rig, server):
    server.state.add_job("job-1")
    rig.agent.heartbeat_once()
    rig.agent.work_once()
    assert set(server.state.auth_headers) == {"Bearer " + "T" * 40}


def test_heartbeat_contenido(rig, server):
    rig.agent.heartbeat_once()
    hb = server.state.heartbeats[-1]
    assert hb["printer"] == "Zebra Test" and hb["printer_ok"] is True and hb["queue_size"] == 0 and hb["last_error"] is None
    assert "panel_state" not in hb  # modo api


def test_heartbeat_impresora_no_existe(tmp_path, server, sumatra_log):
    r = Rig(tmp_path, server, printers=())
    r.agent.heartbeat_once()
    hb = server.state.heartbeats[-1]
    assert hb["printer_ok"] is False and "Zebra Test" in hb["last_error"]


def test_cambio_de_config_version_recarga(rig, server):
    rig.agent.heartbeat_once()
    assert rig.agent.remote is not None and rig.agent.remote.config_version == "v1"
    server.state.config_version = "v2"
    server.state.print_cfg = {"copies": 2, "print_settings": "fit"}
    rig.agent.heartbeat_once()
    assert rig.agent.remote.config_version == "v2"
    server.state.add_job("j", "IZ-CO-000009")
    rig.agent.work_once()


def test_ajustes_remotos_de_impresion(rig, server, sumatra_log):
    server.state.print_cfg = {"copies": 2, "print_settings": "fit,paper=A6"}
    rig.agent.refresh_config()
    server.state.add_job("j", "IZ-CO-000009")
    rig.agent.work_once()
    args = prints_in(sumatra_log)[0]
    assert args[args.index("-print-settings") + 1] == "fit,paper=A6,2x"


# ------------------------------------------------------------------ nunca dos veces


def test_servidor_no_recibe_el_resultado_se_reintenta_el_aviso_no_la_impresion(rig, server, sumatra_log):
    server.state.add_job("job-1")
    server.state.result_mode = "lose_request"
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 1
    assert server.state.results == []
    assert rig.agent.store.queue_size() == 1  # pendiente de avisar
    server.state.result_mode = "normal"
    rig.agent.work_once()  # el claim devuelve job-1 (sigue reclamado) pero no se reimprime
    assert len(prints_in(sumatra_log)) == 1
    assert [r["status"] for r in server.state.results] == ["printed"]
    assert rig.agent.store.queue_size() == 0


def test_respuesta_perdida_el_servidor_aplico_y_el_reintento_es_idempotente(rig, server, sumatra_log):
    server.state.add_job("job-1")
    server.state.result_mode = "lose_response"
    rig.agent.work_once()
    server.state.result_mode = "normal"
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 1
    dups = [r["dup"] for r in server.state.results]
    assert dups[0] is False and all(dups[1:]) and len(dups) >= 2  # repetir el resultado: duplicado, sin cambios


def test_reinicio_con_resultado_pendiente_no_reimprime(tmp_path, server, sumatra_log):
    r = Rig(tmp_path, server)
    server.state.add_job("job-1")
    server.state.result_mode = "lose_request"
    r.agent.work_once()
    server.state.result_mode = "normal"
    nuevo = r.new_agent()  # el agente se reinició
    nuevo.startup()
    nuevo.work_once()
    assert len(prints_in(sumatra_log)) == 1
    assert server.state.results[-1]["status"] == "printed"


class _Crash(BaseException):
    """Simula que el proceso muere (no es una Exception normal)."""


class _CrashAfterPrint(PrintService):
    def print_pdf(self, pdf, settings):
        super().print_pdf(pdf, settings)  # el papel salió...
        raise _Crash()  # ...y el agente murió antes de anotar el resultado


class _CrashBeforePrint(PrintService):
    def print_pdf(self, pdf, settings):
        raise _Crash()


@pytest.mark.parametrize("cls,veces", [(_CrashAfterPrint, 1), (_CrashBeforePrint, 0)])
def test_reinicio_a_mitad_de_la_impresion_no_reimprime(tmp_path, server, sumatra_log, cls, veces):
    r = Rig(tmp_path, server)
    server.state.add_job("job-1")
    crashing = r.new_agent(printer_cls=cls)
    with pytest.raises(_Crash):
        crashing.work_once()
    assert len(prints_in(sumatra_log)) == veces
    # Reinicio: mismo SQLite, agente nuevo
    nuevo = r.new_agent()
    nuevo.startup()
    nuevo.work_once()
    nuevo.work_once()
    assert len(prints_in(sumatra_log)) == veces  # JAMÁS una segunda impresión automática
    res = server.state.results
    assert len(res) == 1 and res[0]["status"] == "failed" and res[0]["error"] == INTERRUPTED_MESSAGE


def test_trabajo_duplicado_de_un_pedido_ya_impreso_no_se_imprime(rig, server, sumatra_log):
    server.state.add_job("job-1", "IZ-CO-000005")
    rig.agent.work_once()
    server.state.add_job("job-2", "IZ-CO-000005")  # defensa: no debería ocurrir, pero si llega...
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 1
    assert {r["id"]: r["status"] for r in server.state.results} == {"job-1": "printed", "job-2": "printed"}


def test_reimpresion_manual_si_se_imprime(rig, server, sumatra_log):
    server.state.add_job("job-1", "IZ-CO-000005")
    rig.agent.work_once()
    server.state.add_job("job-2", "IZ-CO-000005", reprint=True)  # requested_by = admin:*
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 2


# ------------------------------------------------------------------ fallos de impresión


def test_tres_fallos_seguidos_son_failed(rig, server, sumatra_log, monkeypatch):
    monkeypatch.setenv("FAKE_SUMATRA_EXITS", "5")
    server.state.add_job("job-1")
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 3
    r = server.state.results[0]
    assert r["status"] == "failed" and r["attempts"] == 3 and "código 5" in r["error"]
    rig.agent.heartbeat_once()
    assert "código 5" in server.state.heartbeats[-1]["last_error"]


def test_reintenta_y_acaba_imprimiendo(rig, server, sumatra_log, monkeypatch):
    monkeypatch.setenv("FAKE_SUMATRA_EXITS", "5,5,0")
    server.state.add_job("job-1")
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 3
    assert server.state.results[0]["status"] == "printed" and server.state.results[0]["attempts"] == 3


def test_tiempo_agotado_no_se_reintenta(tmp_path, server, sumatra_log, monkeypatch):
    monkeypatch.setenv("FAKE_SUMATRA_SLEEP", "3")
    r = Rig(tmp_path, server)
    r.agent.printer.timeout = 1
    server.state.add_job("job-1")
    r.agent.work_once()
    assert len(prints_in(sumatra_log)) == 1
    assert server.state.results[0]["status"] == "failed" and "no se sabe si la guía salió" in server.state.results[0]["error"]


def test_sin_impresora_no_reclama_y_espera(tmp_path, server, sumatra_log):
    r = Rig(tmp_path, server, printers=())
    server.state.add_job("job-1")
    r.agent.work_once()
    assert server.state.jobs["job-1"]["status"] == "queued"
    assert ("POST", "/api/agent/jobs/claim") not in server.state.requests


def test_impresora_desaparece_tras_reclamar_espera_y_luego_falla(tmp_path, server, sumatra_log):
    r = Rig(tmp_path, server, printer_wait_minutes=1)
    server.state.add_job("job-1")
    server.state.jobs["job-1"].update(status="claimed", agent="agent-1")
    r.printers.clear()
    r.agent.store.register("job-1", "label", "IZ-CO-1", False, None)  # ya reclamado antes de que se fuera la impresora
    assert r.agent.work_once() == 0 and server.state.results == []
    r.printers.append("Zebra Test")
    r.agent.work_once()
    assert server.state.results[0]["status"] == "printed"


def test_impresora_ausente_demasiado_tiempo(tmp_path, server, sumatra_log):
    r = Rig(tmp_path, server, printer_wait_minutes=1)
    server.state.add_job("job-1")
    server.state.jobs["job-1"].update(status="claimed", agent="agent-1")
    r.agent.store.register("job-1", "label", "IZ-CO-1", False, None)
    r.agent.store._db.execute("UPDATE jobs SET created_at = '2020-01-01T00:00:00+00:00' WHERE id = 'job-1'")
    r.printers.clear()
    r.agent.work_once()
    assert server.state.results[0]["status"] == "failed" and "no estuvo disponible" in server.state.results[0]["error"]
    assert prints_in(sumatra_log) == []


# ------------------------------------------------------------------ descargas


def test_no_es_pdf_falla_sin_imprimir(rig, server, sumatra_log):
    server.state.add_job("job-1", pdf=b"<html>error</html>")
    rig.agent.work_once()
    assert prints_in(sumatra_log) == []
    assert server.state.results[0]["status"] == "failed"


def test_lista_de_empaque_no_disponible(rig, server, sumatra_log):
    server.state.add_job("job-1", type_="packing_list")
    rig.agent.work_once()
    assert prints_in(sumatra_log) == []
    assert server.state.results[0]["status"] == "failed" and "501" in server.state.results[0]["error"]


def test_servidor_caido_al_descargar_se_reintenta_luego(rig, server, sumatra_log):
    server.state.add_job("job-1")
    server.state.fail["label"] = [503] * 6  # agota los reintentos de una descarga
    rig.agent.work_once()
    assert prints_in(sumatra_log) == [] and server.state.results == []
    rig.agent.work_once()
    assert len(prints_in(sumatra_log)) == 1 and server.state.results[0]["status"] == "printed"


def test_id_de_trabajo_peligroso_se_ignora(rig, server, sumatra_log):
    server.state.add_job("../../evil")
    assert rig.agent.work_once() == 0
    assert prints_in(sumatra_log) == []


def test_reanuda_trabajos_ya_reclamados_tras_reinicio(tmp_path, server, sumatra_log):
    r = Rig(tmp_path, server)
    server.state.add_job("job-1")
    server.state.fail["label"] = [503] * 6
    r.agent.work_once()  # reclamado pero sin descargar
    nuevo = r.new_agent()
    nuevo.startup()
    nuevo.work_once()
    assert len(prints_in(sumatra_log)) == 1


def test_cierre_con_servidor_inaccesible_no_pierde_el_resultado(tmp_path, server, sumatra_log):
    import httpx

    from izao_agent.api import ApiError

    r = Rig(tmp_path, server)
    server.state.add_job("job-1")
    server.state.result_mode = "lose_request"
    r.agent.work_once()

    def caido(request):
        raise httpx.ConnectError("sin red")

    r.agent.api._client = httpx.Client(transport=httpx.MockTransport(caido))
    with pytest.raises(ApiError):
        r.agent.work_once()  # el claim falla: sin red
    assert r.agent.store.queue_size() == 1
    assert len(prints_in(sumatra_log)) == 1
