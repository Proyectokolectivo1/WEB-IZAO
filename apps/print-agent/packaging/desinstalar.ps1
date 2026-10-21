# Desinstala el Agente de Impresión de Izao (quita la tarea programada, el token y los archivos).
param(
    [string]$Destino = "C:\IzaoAgent",
    [switch]$NoInteractivo,
    [switch]$BorrarDatos
)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$exe = Join-Path $Destino "izao-agent.exe"
$tarea = "Izao Agente de Impresion"

if (-not $NoInteractivo) {
    $r = Read-Host "Se quitará el Agente de Impresión de este PC. ¿Continuar? (S/N)"
    if ($r.Trim().ToUpper() -ne "S") { Write-Host "No se hizo ningún cambio."; exit 0 }
}
if (Test-Path $exe) { try { & $exe stop | Out-Null } catch { }; Start-Sleep -Seconds 6 }
Get-Process -Name "izao-agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $tarea -Confirm:$false -ErrorAction SilentlyContinue
$atajo = Join-Path ([Environment]::GetFolderPath("Startup")) "Izao Agente de Impresion.lnk"
Remove-Item $atajo -Force -ErrorAction SilentlyContinue
if (Test-Path $exe) { try { & $exe forget-token | Out-Null } catch { } }
Write-Host "  [ OK ] Tarea programada y token eliminados."

if (-not $BorrarDatos -and -not $NoInteractivo) {
    $BorrarDatos = ((Read-Host "¿Borrar también registros, perfil de Chrome y guías guardadas? (S/N)").Trim().ToUpper() -eq "S")
}
if ($BorrarDatos) {
    Remove-Item (Join-Path $env:LOCALAPPDATA "IzaoAgent") -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [ OK ] Datos borrados."
}
# La carpeta de instalación se borra al final (este script puede estar dentro de ella).
if (Test-Path $Destino) {
    Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c timeout /t 3 >nul & rmdir /s /q `"$Destino`""
}
Write-Host "  Listo. El agente fue desinstalado."
if (-not $NoInteractivo) { Read-Host "Pulse Enter para cerrar" | Out-Null }
