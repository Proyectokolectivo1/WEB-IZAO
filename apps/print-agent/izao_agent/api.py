"""Cliente HTTP del contrato v1 (`docs/integraciones/agente-api.md`). Solo conexiones salientes.

- Reintenta con espera exponencial (con azar) ante red caída, 408, 429 y 5xx. Los 4xx no se reintentan.
- El token se lee de una función en cada petición y nunca se escribe en logs.
- Toda llamada es idempotente según el contrato: repetirla es seguro.
"""

from __future__ import annotations

import base64
import logging
import random
import re
import time
from typing import Any, Callable

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError
from tenacity import RetryCallState, Retrying, retry_if_exception_type, stop_after_attempt

from . import __version__

log = logging.getLogger("izao.api")

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")


class ApiError(Exception):
    pass


class TransientError(ApiError):
    """Red caída, tiempo agotado, 408/429/5xx: se puede reintentar."""


class AuthError(ApiError):
    """401: token inválido o agente desactivado."""


class PermanentError(ApiError):
    def __init__(self, status: int, code: str):
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code


class ClaimedJob(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    type: str
    order_number: str | None = None
    reprint: bool = False
    created_at: str | None = None
    claimed_at: str | None = None


class AgentApi:
    def __init__(
        self,
        base_url: str,
        token_getter: Callable[[], str],
        *,
        timeout: float = 30.0,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        wait_initial: float = 1.0,
        wait_max: float = 60.0,
        long_attempts: int = 6,
        short_attempts: int = 2,
    ):
        self._base = base_url.rstrip("/")
        self._token = token_getter
        self._client = client or httpx.Client(timeout=timeout, follow_redirects=False)
        self._sleep = sleep
        self._wait_initial = wait_initial
        self._wait_max = wait_max
        self._long = long_attempts
        self._short = short_attempts

    def close(self) -> None:
        self._client.close()

    # ---- núcleo
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token()}", "User-Agent": f"IzaoAgent/{__version__}", "Accept": "application/json"}

    def _check(self, status: int, body_reader: Callable[[], bytes]) -> None:
        if status == 200:
            return
        if status == 401:
            raise AuthError("El servidor rechazó el token del agente (401). Revise el token o que el agente esté activo en el panel.")
        if status in (408, 429, 500, 502, 503, 504):  # 501 no_disponible es definitivo
            raise TransientError(f"El servidor respondió {status}")
        code = "desconocido"
        try:
            parsed = httpx.Response(status, content=body_reader()).json()
            if isinstance(parsed, dict) and isinstance(parsed.get("error"), str):
                code = parsed["error"][:60]
        except Exception:
            pass
        raise PermanentError(status, code)

    def _once_json(self, method: str, path: str, payload: dict[str, Any] | None) -> dict[str, Any]:
        try:
            r = self._client.request(method, self._base + path, json=payload, headers=self._headers())
        except httpx.HTTPError as exc:
            raise TransientError(f"Sin conexión con el servidor ({type(exc).__name__})") from exc
        self._check(r.status_code, lambda: r.content)
        try:
            data = r.json()
        except ValueError as exc:
            raise TransientError("Respuesta del servidor no es JSON") from exc
        if not isinstance(data, dict):
            raise TransientError("Respuesta del servidor inesperada")
        return data

    def _wait(self, state: RetryCallState) -> float:
        """Espera exponencial con azar: 1 s, 2 s, 4 s ... hasta `wait_max`."""
        base = min(self._wait_max, self._wait_initial * (2 ** (state.attempt_number - 1)))
        return base + random.uniform(0, base / 2)

    def _retrying(self, attempts: int) -> Retrying:
        return Retrying(
            stop=stop_after_attempt(attempts),
            wait=self._wait,
            retry=retry_if_exception_type(TransientError),
            sleep=self._sleep,
            reraise=True,
        )

    def _json(self, method: str, path: str, payload: dict[str, Any] | None = None, *, long: bool = False) -> dict[str, Any]:
        return self._retrying(self._long if long else self._short)(self._once_json, method, path, payload)

    # ---- endpoints
    def heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json("POST", "/api/agent/heartbeat", payload)

    def claim(self, max_jobs: int = 5) -> list[ClaimedJob]:
        data = self._json("POST", "/api/agent/jobs/claim", {"max": max(1, min(5, max_jobs))})
        out: list[ClaimedJob] = []
        for raw in data.get("jobs", []) or []:
            try:
                job = ClaimedJob.model_validate(raw)
            except ValidationError:
                log.warning("Trabajo ignorado: formato inesperado")
                continue
            if not _JOB_ID_RE.match(job.id):  # el id forma parte de una ruta de archivo: nunca confiar
                log.warning("Trabajo ignorado: identificador no válido")
                continue
            out.append(job)
        return out

    def get_config(self) -> dict[str, Any]:
        return self._json("GET", "/api/agent/config")

    def download_label(self, job_id: str) -> bytes:
        """Descarga el PDF. La ruta se arma aquí (no se sigue la que diga el servidor)."""
        if not _JOB_ID_RE.match(job_id):
            raise ValueError("id de trabajo no válido")
        return self._retrying(self._long)(self._once_download, f"/api/agent/jobs/{job_id}/label")

    def _once_download(self, path: str) -> bytes:
        try:
            with self._client.stream("GET", self._base + path, headers={**self._headers(), "Accept": "application/pdf"}) as r:
                if r.status_code != 200:
                    r.read()
                self._check(r.status_code, lambda: r.content)
                chunks: list[bytes] = []
                total = 0
                for chunk in r.iter_bytes():
                    total += len(chunk)
                    if total > MAX_PDF_BYTES:
                        raise PermanentError(413, "muy_grande")
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            raise TransientError(f"Sin conexión al descargar el PDF ({type(exc).__name__})") from exc
        return b"".join(chunks)

    def post_result(
        self,
        job_id: str,
        status: str,
        attempts: int,
        error: str | None = None,
        screenshot_png: bytes | None = None,
    ) -> dict[str, Any]:
        if not _JOB_ID_RE.match(job_id):
            raise ValueError("id de trabajo no válido")
        body: dict[str, Any] = {"status": status, "attempts": max(1, min(10, attempts))}
        if status == "failed":
            body["error"] = (error or "Error sin detalle")[:1000]
        if screenshot_png and len(screenshot_png) <= MAX_SCREENSHOT_BYTES:
            body["screenshot_png_base64"] = base64.b64encode(screenshot_png).decode("ascii")
        return self._json("POST", f"/api/agent/jobs/{job_id}/result", body, long=True)
