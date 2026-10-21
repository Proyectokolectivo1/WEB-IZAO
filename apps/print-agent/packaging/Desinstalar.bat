@echo off
title Desinstalar el Agente de Impresion de Izao
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstalar.ps1" %*
if errorlevel 1 pause
