"""Rutas del agente. Los datos viven en %LOCALAPPDATA%/IzaoAgent (nunca junto al ejecutable)."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def install_dir() -> Path:
    """Carpeta del ejecutable (C:/IzaoAgent) o, en desarrollo, la de apps/print-agent."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def data_dir() -> Path:
    override = os.environ.get("IZAO_AGENT_HOME")
    if override:
        base = Path(override)
    else:
        local = os.environ.get("LOCALAPPDATA")
        base = Path(local) / "IzaoAgent" if local else Path.home() / ".izao-agent"
    base.mkdir(parents=True, exist_ok=True)
    return base


def labels_dir() -> Path:
    p = data_dir() / "labels"
    p.mkdir(parents=True, exist_ok=True)
    return p


def logs_dir() -> Path:
    p = data_dir() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def screenshots_dir() -> Path:
    p = data_dir() / "screenshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def chrome_profile_dir() -> Path:
    return data_dir() / "chrome-profile"


def db_path() -> Path:
    return data_dir() / "agent.db"


def alive_file() -> Path:
    return data_dir() / "alive"


def stop_flag() -> Path:
    return data_dir() / "detener.flag"


def default_config_path() -> Path:
    env = os.environ.get("IZAO_AGENT_CONFIG")
    if env:
        return Path(env)
    return install_dir() / "config.yaml"


def default_sumatra_path() -> Path:
    return install_dir() / "SumatraPDF.exe"
