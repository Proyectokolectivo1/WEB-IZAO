"""Servidor falso del contrato v1 (`docs/integraciones/agente-api.md`) + un "panel" de pruebas para el modo panel."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from izao_agent.testpdf import build_test_pdf

TOKEN = "T" * 40


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: dict[str, dict] = {}
        self.heartbeats: list[dict] = []
        self.results: list[dict] = []
        self.requests: list[tuple[str, str]] = []
        self.auth_headers: list[str] = []
        self.config_version = "v1"
        self.mode = "api"
        self.print_cfg = None
        self.panel_cfg = None
        self.intervals = {"heartbeat_seconds": 30, "claim_seconds": 10, "panel_retry_seconds": 300}
        # Inyección de fallos: {"claim": [503, 503]} -> las próximas respuestas de esa ruta
        self.fail: dict[str, list[int]] = {}
        self.result_mode = "normal"  # normal | lose_request (503 sin aplicar) | lose_response (aplica y responde 503)
        self.agent_id = "agent-1"

    def add_job(self, job_id: str, order: str = "IZ-CO-000001", type_: str = "label", reprint: bool = False, pdf: bytes | None = None, label_url: str | None = None):
        self.jobs[job_id] = {
            "id": job_id, "type": type_, "order_number": order, "reprint": reprint, "status": "queued",
            "agent": None, "claimed_at": None, "pdf": pdf if pdf is not None else build_test_pdf(order), "result": None,
            "label_url": label_url,
        }


def _handler(state: State):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):  # silencio
            pass

        def _send(self, code: int, body: bytes, ctype: str = "application/json", extra: dict | None = None):
            self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj: dict):
            self._send(code, json.dumps(obj).encode())

        def _body(self) -> dict:
            n = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(n) if n else b""
            return json.loads(raw) if raw else {}

        def _injected(self, key: str) -> bool:
            with state.lock:
                q = state.fail.get(key)
                if q:
                    code = q.pop(0)
                    self._json(code, {"error": "inyectado"})
                    return True
            return False

        def _auth(self) -> bool:
            h = self.headers.get("authorization", "")
            with state.lock:
                state.auth_headers.append(h)
            if h != f"Bearer {TOKEN}":
                self._json(401, {"error": "no_autorizado"})
                return False
            return True

        # ---------------------------------------------------------------- panel falso (modo panel)
        def _panel_get(self) -> bool:
            p = self.path
            if p == "/panel/orders":
                html = (
                    "<html><head><title>Pedidos</title></head><body><div id='menu'>Sesion activa</div>"
                    "<input id='buscar'/><button id='ir' onclick=\"document.getElementById('res').innerText='Pedido '+document.getElementById('buscar').value\">Buscar</button>"
                    "<div id='res'></div><a id='guia' href='/panel/pdf'>Descargar guia</a></body></html>"
                )
                self._send(200, html.encode(), "text/html; charset=utf-8")
                return True
            if p == "/panel/login":
                self._send(200, b"<html><title>Entrar</title><body><form id='login'>usuario</form></body></html>", "text/html")
                return True
            if p == "/panel/challenge":
                self._send(200, b"<html><title>Un momento...</title><body><div id='challenge-form'>verificando</div></body></html>", "text/html")
                return True
            if p == "/panel/pdf":
                self._send(200, build_test_pdf("panel"), "application/pdf", {"content-disposition": 'attachment; filename="guia.pdf"'})
                return True
            return False

        # ---------------------------------------------------------------- API
        def do_GET(self):
            with state.lock:
                state.requests.append(("GET", self.path))
            if self.path.startswith("/panel/") and self._panel_get():
                return
            if not self.path.startswith("/api/agent/"):
                return self._json(404, {"error": "no_encontrado"})
            if not self._auth():
                return
            if self.path == "/api/agent/config":
                if self._injected("config"):
                    return
                with state.lock:
                    body = {
                        "contract_version": 1, "config_version": state.config_version,
                        "agent": {"id": state.agent_id, "name": "PC despacho", "mode": state.mode},
                        "intervals": state.intervals, "max_claim": 5, "print": state.print_cfg, "panel": state.panel_cfg,
                    }
                return self._json(200, body)
            parts = self.path.split("/")
            if len(parts) == 6 and parts[3] == "jobs" and parts[5] == "label":
                if self._injected("label"):
                    return
                with state.lock:
                    job = state.jobs.get(parts[4])
                    if not job or job["agent"] != state.agent_id:
                        return self._json(404, {"error": "no_encontrado"})
                    if job.get("label_url"):  # 1.1: el servidor no tiene copia
                        return self._json(404, {"error": "no_encontrado"})
                    if job["type"] == "packing_list":
                        return self._json(501, {"error": "no_disponible"})
                    pdf = job["pdf"]
                return self._send(200, pdf, "application/pdf")
            return self._json(404, {"error": "no_encontrado"})

        def do_POST(self):
            with state.lock:
                state.requests.append(("POST", self.path))
            if not self._auth():
                return
            data = self._body()
            if self.path == "/api/agent/heartbeat":
                if self._injected("heartbeat"):
                    return
                with state.lock:
                    state.heartbeats.append(data)
                    cv = state.config_version
                return self._json(200, {"ok": True, "server_time": "2026-10-20T00:00:00Z", "config_version": cv})
            if self.path == "/api/agent/jobs/claim":
                if self._injected("claim"):
                    return
                mx = int(data.get("max", 5))
                out = []
                with state.lock:
                    mine = [j for j in state.jobs.values() if j["status"] == "claimed" and j["agent"] == state.agent_id]
                    queued = [j for j in state.jobs.values() if j["status"] == "queued"]
                    for j in (mine + queued)[:mx]:
                        if j["status"] == "queued":
                            j["status"], j["agent"], j["claimed_at"] = "claimed", state.agent_id, "2026-10-20T15:00:05.000Z"
                        out.append({
                            "id": j["id"], "type": j["type"], "order_number": j["order_number"], "reprint": j["reprint"],
                            "created_at": "2026-10-20T15:00:00.000Z", "claimed_at": j["claimed_at"],
                            "label_path": f"/api/agent/jobs/{j['id']}/label",
                            "label_url": j.get("label_url"),
                        })
                return self._json(200, {"jobs": out})
            parts = self.path.split("/")
            if len(parts) == 6 and parts[3] == "jobs" and parts[5] == "result":
                if self._injected("result"):
                    return
                mode = state.result_mode
                if mode == "lose_request":
                    return self._json(503, {"error": "no_disponible_temporalmente"})
                with state.lock:
                    job = state.jobs.get(parts[4])
                    if not job or job["agent"] != state.agent_id:
                        return self._json(409, {"error": "estado_invalido"})
                    new = {"status": data.get("status"), "error": data.get("error"), "attempts": data.get("attempts"), "shot": "screenshot_png_base64" in data}
                    dup = False
                    if job["status"] in ("printed", "failed"):
                        if job["result"] and job["result"]["status"] == new["status"]:
                            dup = True
                        else:
                            return self._json(409, {"error": "estado_invalido"})
                    else:
                        job["status"], job["result"] = new["status"], new
                    state.results.append({"id": parts[4], **new, "dup": dup})
                if mode == "lose_response":
                    return self._json(503, {"error": "no_disponible_temporalmente"})
                return self._json(200, {"ok": True, "duplicado": dup})
            return self._json(404, {"error": "no_encontrado"})

    return H


class FakeServer:
    def __init__(self):
        self.state = State()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self.state))
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
