@echo off
schtasks /Run /TN "Izao Agente de Impresion" >/dev/null 2>&1
if errorlevel 1 (start "" /min "%~dp0izao-agent.exe" supervisor)
echo El agente se esta iniciando.
timeout /t 4 >nul
