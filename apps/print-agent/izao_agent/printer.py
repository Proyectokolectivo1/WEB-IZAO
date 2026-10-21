"""Impresión silenciosa con SumatraPDF y detección de impresoras de Windows.

Comando (doc oficial de SumatraPDF, "Command-line arguments"):
  SumatraPDF.exe -print-to "<impresora>" -print-settings "<ajustes>" -silent "<pdf>"
Códigos de salida de -print-to: 0 ok; 2 no se pudo abrir el archivo; 3 el documento no permite imprimir;
4 la impresora no existe; 5 falló el controlador o dispositivo; 6 impresión deshabilitada por política.
Los fallos posteriores al envío (sin papel, impresora apagada) NO se reflejan en el código de salida.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

log = logging.getLogger("izao.printer")

EXIT_MEANINGS = {
    2: "SumatraPDF no pudo abrir el PDF",
    3: "el PDF no permite imprimir",
    4: "la impresora no existe",
    5: "falló el controlador o el dispositivo de la impresora",
    6: "la impresión está deshabilitada por una política de Windows",
}

_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


def list_printers() -> list[str]:
    """Nombres de las impresoras instaladas (win32print; si falla, PowerShell)."""
    if sys.platform != "win32":
        return []
    try:
        import win32print

        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        # pywin32 reciente devuelve diccionarios; las versiones viejas, tuplas (nombre, servidor, atributos).
        return [(p["pPrinterName"] if isinstance(p, dict) else p[0]) for p in win32print.EnumPrinters(flags, None, 4)]
    except Exception as exc:
        log.warning("win32print falló (%s); uso PowerShell", type(exc).__name__)
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Get-Printer | ForEach-Object { $_.Name }"],
            capture_output=True, text=True, timeout=20, creationflags=_NO_WINDOW,
        )
        return [line.strip() for line in out.stdout.splitlines() if line.strip()]
    except Exception:
        return []


@dataclass
class PrintOutcome:
    ok: bool
    error: str | None = None
    code: int | None = None
    # Si es True no sabemos si el papel salió (tiempo agotado): NO se debe reintentar.
    ambiguous: bool = False
    # Si es True el fallo es de configuración (no existe SumatraPDF): reintentar no sirve.
    fatal: bool = False


class PrintService:
    def __init__(
        self,
        sumatra: str | Path,
        printer: str,
        timeout: int = 60,
        *,
        command_prefix: Sequence[str] | None = None,
        lister: Callable[[], list[str]] = list_printers,
    ):
        self.sumatra = str(sumatra)
        self.printer = printer
        self.timeout = timeout
        self._prefix = list(command_prefix) if command_prefix else [self.sumatra]
        self._lister = lister

    def printer_available(self) -> bool:
        if not self.printer:
            return False
        wanted = self.printer.casefold()
        return any(n.casefold() == wanted for n in self._lister())

    def sumatra_available(self) -> bool:
        return Path(self.sumatra).exists() or self._prefix[0] != self.sumatra

    def build_command(self, pdf: str | Path, settings: str) -> list[str]:
        cmd = [*self._prefix, "-print-to", self.printer]
        if settings:
            cmd += ["-print-settings", settings]
        cmd += ["-silent", str(pdf)]
        return cmd

    def print_pdf(self, pdf: str | Path, settings: str) -> PrintOutcome:
        if not self.sumatra_available():
            return PrintOutcome(False, f"No encuentro SumatraPDF.exe en {self.sumatra}", fatal=True)
        cmd = self.build_command(pdf, settings)
        # Sin shell: la lista de argumentos evita cualquier inyección por nombres con espacios o comillas.
        log.info("Imprimiendo %s en '%s' (ajustes: %s)", Path(pdf).name, self.printer, settings or "ninguno")
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout, creationflags=_NO_WINDOW if sys.platform == "win32" else 0)
        except subprocess.TimeoutExpired:
            return PrintOutcome(False, f"SumatraPDF no terminó en {self.timeout} s; no se sabe si la guía salió", ambiguous=True)
        except FileNotFoundError:
            return PrintOutcome(False, f"No encuentro SumatraPDF.exe en {self.sumatra}", fatal=True)
        except OSError as exc:
            return PrintOutcome(False, f"No pude iniciar SumatraPDF ({type(exc).__name__})", fatal=True)
        if r.returncode == 0:
            return PrintOutcome(True, code=0)
        meaning = EXIT_MEANINGS.get(r.returncode, "error desconocido")
        return PrintOutcome(False, f"SumatraPDF terminó con código {r.returncode}: {meaning}", code=r.returncode)
