@echo off
title Instalador del Agente de Impresion de Izao
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
if errorlevel 1 (
  echo.
  echo Hubo un problema. Tome una foto de esta pantalla y envieela a soporte.
  pause
)
