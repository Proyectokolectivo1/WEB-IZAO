"""Punto de entrada de izao-agent.exe (PyInstaller)."""
import sys

from izao_agent.cli import main

if __name__ == "__main__":
    sys.exit(main())
