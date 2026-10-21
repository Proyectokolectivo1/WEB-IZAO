@echo off
"%~dp0izao-agent.exe" stop
echo Se pidio detener el agente. Espere unos segundos.
timeout /t 5 >nul
