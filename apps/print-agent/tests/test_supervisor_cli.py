from __future__ import annotations

import os
import sys
import time

from izao_agent import paths
from izao_agent.cli import main
from izao_agent.store import Store
from izao_agent.supervisor import EXIT_CONFIG, supervise

from .fake_server import TOKEN


def test_vigilante_reinicia_si_el_agente_muere(tmp_path):
    stop = tmp_path / "stop"
    n = supervise([sys.executable, "-c", "import sys; sys.exit(1)"], stop_flag=stop, alive_file=tmp_path / "alive",
                  min_backoff=0.01, max_backoff=0.02, poll=0.01, max_starts=3)
    assert n == 3


def test_vigilante_se_detiene_con_la_bandera(tmp_path):
    stop = tmp_path / "stop"
    stop.write_text("x")
    assert supervise([sys.executable, "-c", "pass"], stop_flag=stop, alive_file=tmp_path / "alive", poll=0.01) == 0


def test_vigilante_mata_un_agente_colgado(tmp_path):
    stop = tmp_path / "stop"
    t0 = time.time()
    n = supervise([sys.executable, "-c", "import time; time.sleep(60)"], stop_flag=stop, alive_file=tmp_path / "alive",
                  hang_seconds=0.5, min_backoff=0.01, poll=0.05, max_starts=1)
    assert n == 1 and time.time() - t0 < 20


def test_vigilante_espera_si_la_configuracion_esta_mal(tmp_path, monkeypatch):
    import izao_agent.supervisor as sup

    monkeypatch.setattr(sup, "CONFIG_WAIT", 0.05)
    n = supervise([sys.executable, "-c", f"import sys; sys.exit({EXIT_CONFIG})"], stop_flag=tmp_path / "stop",
                  alive_file=tmp_path / "alive", poll=0.01, max_starts=2)
    assert n == 2


def test_cli_version(capsys):
    assert main(["version"]) == 0
    assert "izao-agent" in capsys.readouterr().out


def test_doctor_contra_servidor_falso(server, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("IZAO_AGENT_HOME", str(tmp_path / "datos"))
    monkeypatch.setenv("IZAO_AGENT_TOKEN", TOKEN)
    cfg = tmp_path / "config.yaml"
    cfg.write_text(f"server_url: {server.url}\nprinter: 'Impresora Que No Existe'\nsumatra_path: {sys.executable!r}\n", encoding="utf-8")
    code = main(["doctor", "--config", str(cfg)])
    out = capsys.readouterr().out
    assert code == 1  # la impresora no existe
    assert "[FALTA] Impresora 'Impresora Que No Existe'" in out
    assert "El servidor responde y acepta el token" in out
    assert TOKEN not in out


def test_doctor_sin_config(tmp_path, capsys):
    assert main(["doctor", "--config", str(tmp_path / "no.yaml")]) == 78
    assert "No encuentro" in capsys.readouterr().out


def test_store_recupera_y_purga(tmp_path):
    s = Store(tmp_path / "x.db")
    s.register("a", "label", "IZ-1", False, None)
    s.set_downloaded("a", "a.pdf")
    assert s.begin_attempt("a") == 1
    assert s.recover_interrupted() == ["a"]
    row = s.get("a")
    assert row["phase"] == "finished" and row["result_status"] == "failed"
    # begin_attempt no reabre un trabajo ya terminado
    s.begin_attempt("a")
    assert s.get("a")["phase"] == "finished"
    s.mark_reported("a")
    assert s.queue_size() == 0
    assert s.purge_old("2999-01-01T00:00:00+00:00") == 1


def test_datos_en_la_carpeta_indicada(tmp_path, monkeypatch):
    monkeypatch.setenv("IZAO_AGENT_HOME", str(tmp_path / "d"))
    assert paths.labels_dir().is_dir() and str(paths.db_path()).startswith(str(tmp_path))
    assert os.path.basename(paths.chrome_profile_dir()) == "chrome-profile"
