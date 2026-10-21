"""Configuración local (`config.yaml`) y configuración remota (`GET /api/agent/config`).

La local solo trae lo que depende de este PC (impresora, rutas, URL del servidor). Todo lo demás
(intervalos, copias, ajustes de impresión, pasos y selectores del modo panel) puede venir del servidor
y NUNCA está escrito en el código (regla del proyecto: selectores del modo panel siempre remotos).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

# Solo caracteres que usa -print-settings de SumatraPDF (se pasa como argumento, nunca por shell).
_SETTINGS_RE = re.compile(r"^[A-Za-z0-9 ,=\-_.]*$")
_LOOPBACK = {"localhost", "127.0.0.1", "::1"}


class ConfigError(Exception):
    """Error de configuración con mensaje en español sencillo."""


class Intervals(BaseModel):
    model_config = ConfigDict(extra="ignore")
    heartbeat_seconds: int = Field(30, ge=5, le=600)
    claim_seconds: int = Field(10, ge=2, le=300)
    panel_retry_seconds: int = Field(300, ge=30, le=3600)


class LocalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_url: str = "https://izaoperfumeria.com"
    printer: str = ""
    copies: int = Field(1, ge=1, le=20)
    print_settings: str = "noscale"
    sumatra_path: str = ""  # vacío = SumatraPDF.exe junto al ejecutable
    print_timeout_seconds: int = Field(60, ge=10, le=300)
    max_print_attempts: int = Field(3, ge=1, le=10)
    printer_wait_minutes: int = Field(30, ge=1, le=240)
    http_timeout_seconds: int = Field(30, ge=5, le=120)
    keep_labels_days: int = Field(30, ge=1, le=365)
    chrome_channel: str = "chrome"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    max_claim: int = Field(5, ge=1, le=5)
    intervals: Intervals = Intervals()

    @field_validator("server_url")
    @classmethod
    def _server_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        u = urlparse(v)
        if not u.hostname or u.scheme not in ("https", "http"):
            raise ValueError("debe ser una dirección como https://izaoperfumeria.com")
        if u.scheme == "http" and u.hostname not in _LOOPBACK:
            raise ValueError("solo se permite https (http solo para pruebas en este mismo PC)")
        return v

    @field_validator("print_settings")
    @classmethod
    def _settings(cls, v: str) -> str:
        if not _SETTINGS_RE.match(v):
            raise ValueError("contiene caracteres no permitidos")
        return v.strip()


def _friendly(err: ValidationError) -> str:
    lines = []
    for e in err.errors():
        campo = ".".join(str(p) for p in e["loc"]) or "(general)"
        lines.append(f"  - {campo}: {e['msg']}")
    return "\n".join(lines)


def load_local_config(path: Path) -> LocalConfig:
    if not path.exists():
        raise ConfigError(
            f"No encuentro el archivo de configuración:\n  {path}\n"
            "Copie config.example.yaml como config.yaml y complételo (vea el README)."
        )
    try:
        data: Any = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"El archivo {path.name} tiene un error de formato (revise las sangrías y los dos puntos):\n  {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"El archivo {path.name} debe tener líneas 'clave: valor'.")
    try:
        return LocalConfig.model_validate(data)
    except ValidationError as exc:
        raise ConfigError(f"Hay datos incorrectos en {path.name}:\n{_friendly(exc)}") from exc


# --------------------------------------------------------------------------- remota


class RemotePrint(BaseModel):
    model_config = ConfigDict(extra="ignore")
    copies: int | None = Field(None, ge=1, le=20)
    print_settings: str | None = None

    @field_validator("print_settings")
    @classmethod
    def _settings(cls, v: str | None) -> str | None:
        if v is not None and not _SETTINGS_RE.match(v):
            raise ValueError("ajustes de impresión no permitidos")
        return v


PanelOp = Literal["goto", "click", "fill", "press", "select_option", "wait_for", "wait_ms", "expect_text", "download"]


class PanelAction(BaseModel):
    """Una acción de una lista cerrada (nunca JavaScript arbitrario). Sustituciones: {order_number}, {job_id}."""

    model_config = ConfigDict(extra="ignore")
    op: PanelOp
    selector: str | None = None
    url: str | None = None
    value: str | None = None
    state: Literal["visible", "attached", "hidden", "detached"] = "visible"
    timeout_ms: int = Field(15000, ge=100, le=120000)


class PanelStep(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str  # confirmar | obtener_guia | ... (los define el panel de la tienda)
    enabled: bool = True
    actions: list[PanelAction] = []


class PanelConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    base_url: str
    logged_in_selector: str | None = None
    logged_out_selectors: list[str] = []
    challenge_selectors: list[str] = []
    challenge_title_patterns: list[str] = []
    steps: list[PanelStep] = []

    @field_validator("base_url")
    @classmethod
    def _https(cls, v: str) -> str:
        u = urlparse(v)
        if u.scheme != "https" and u.hostname not in _LOOPBACK:
            raise ValueError("la URL del panel debe ser https")
        return v

    def step(self, name: str) -> PanelStep | None:
        for s in self.steps:
            if s.name == name and s.enabled:
                return s
        return None


class RemoteConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    contract_version: int = 1
    config_version: str = ""
    mode: Literal["api", "panel"] = "api"
    intervals: Intervals | None = None
    max_claim: int | None = Field(None, ge=1, le=5)
    print: RemotePrint | None = None
    panel: PanelConfig | None = None


def parse_remote(data: dict[str, Any]) -> RemoteConfig:
    """Convierte la respuesta de `/api/agent/config`. Lanza ValidationError si no es usable."""
    agent = data.get("agent") if isinstance(data.get("agent"), dict) else {}
    flat = {
        "contract_version": data.get("contract_version", 1),
        "config_version": str(data.get("config_version", "")),
        "mode": agent.get("mode", "api"),
        "intervals": data.get("intervals"),
        "max_claim": data.get("max_claim"),
        "print": data.get("print"),
        "panel": data.get("panel"),
    }
    return RemoteConfig.model_validate(flat)


def effective_print_settings(local: LocalConfig, remote: RemoteConfig | None) -> tuple[str, int]:
    """(ajustes, copias) efectivos: lo remoto manda sobre lo local cuando existe."""
    settings = local.print_settings
    copies = local.copies
    if remote and remote.print:
        if remote.print.print_settings is not None:
            settings = remote.print.print_settings
        if remote.print.copies is not None:
            copies = remote.print.copies
    parts = [p for p in settings.split(",") if p.strip() and not re.fullmatch(r"\s*\d+x\s*", p)]
    if copies > 1:
        parts.append(f"{copies}x")
    return ",".join(p.strip() for p in parts), copies
