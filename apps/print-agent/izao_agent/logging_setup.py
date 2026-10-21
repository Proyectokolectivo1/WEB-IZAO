"""Logs rotativos con redacción de secretos. El token nunca debe llegar a un archivo de log."""

from __future__ import annotations

import logging
import re
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

_lock = threading.Lock()
_secrets: set[str] = set()

_PATTERNS = [
    re.compile(r"(?i)(bearer)\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)((?:authorization|token|password|secret|api[_-]?key)[\"']?\s*[:=]\s*)[\"']?[^\s\"',}]+"),
    re.compile(r"[A-Za-z0-9+/=]{300,}"),  # cargas enormes (p. ej. capturas en base64)
]


def register_secret(value: str) -> None:
    if value and len(value) >= 8:
        with _lock:
            _secrets.add(value)


def redact(text: str) -> str:
    with _lock:
        known = list(_secrets)
    for s in known:
        text = text.replace(s, "***")
    text = _PATTERNS[0].sub(r"\1 ***", text)
    text = _PATTERNS[1].sub(r"\1***", text)
    text = _PATTERNS[2].sub("[dato largo omitido]", text)
    return text


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def setup_logging(log_dir: Path, level: str = "INFO", console: bool = False, name: str = "agent") -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = RedactingFormatter("%(asctime)s %(levelname)s [%(threadName)s] %(message)s", "%Y-%m-%d %H:%M:%S")
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
        h.close()
    root.setLevel(getattr(logging, level, logging.INFO))
    fh = RotatingFileHandler(log_dir / f"{name}.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)
    if console:
        sh = logging.StreamHandler(sys.stderr)
        sh.setFormatter(fmt)
        root.addHandler(sh)
    for noisy in ("httpx", "httpcore", "hpack", "urllib3", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return logging.getLogger("izao")
