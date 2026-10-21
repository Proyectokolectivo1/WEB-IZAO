"""Token del agente: se guarda en el Administrador de credenciales de Windows (keyring), nunca en texto plano."""

from __future__ import annotations

import os
import re
import sys

SERVICE = "IzaoAgent"
ACCOUNT = "agent-token"
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,256}$")
ENV_VAR = "IZAO_AGENT_TOKEN"  # solo para pruebas y desarrollo; en producción se usa el Administrador de credenciales


class TokenError(Exception):
    pass


def _keyring():
    import keyring

    if sys.platform == "win32":
        # Backend explícito: así PyInstaller lo incluye y no depende de la detección automática.
        from keyring.backends.Windows import WinVaultKeyring

        keyring.set_keyring(WinVaultKeyring())
    return keyring


def valid_token(token: str) -> bool:
    return bool(TOKEN_RE.match(token))


def set_token(token: str) -> None:
    token = token.strip()
    if not valid_token(token):
        raise TokenError("El token no es válido: debe tener al menos 32 letras, números, guiones o guiones bajos, sin espacios.")
    _keyring().set_password(SERVICE, ACCOUNT, token)


def get_token() -> str:
    env = os.environ.get(ENV_VAR, "").strip()
    if env:
        return env
    try:
        value = _keyring().get_password(SERVICE, ACCOUNT)
    except Exception as exc:  # backend caído o bloqueado
        raise TokenError(f"No pude leer el token del Administrador de credenciales ({type(exc).__name__}).") from exc
    if not value:
        raise TokenError("Falta el token del agente. Ejecute 'izao-agent set-token' (o el instalador) para guardarlo.")
    return value


def has_token() -> bool:
    try:
        get_token()
        return True
    except TokenError:
        return False


def delete_token() -> None:
    try:
        _keyring().delete_password(SERVICE, ACCOUNT)
    except Exception:
        pass
