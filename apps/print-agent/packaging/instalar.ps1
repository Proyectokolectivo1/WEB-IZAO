# Instalador del Agente de Impresión de Izao.
# Se ejecuta con doble clic en "Instalar.bat". No necesita conocimientos técnicos: solo responda las preguntas.
param(
    [string]$Destino = "C:\IzaoAgent",
    [string]$Impresora = "",
    [string]$UrlServidor = "https://izaoperfumeria.com",
    [switch]$NoInteractivo,
    [switch]$SinToken,
    [switch]$SinTarea,
    [switch]$SinEnergia,
    [switch]$SinChrome
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$origen = Split-Path -Parent $MyInvocation.MyCommand.Path

function Paso($n, $texto) { Write-Host ""; Write-Host "=== Paso $n. $texto ===" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  [ OK ] $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "  [ AVISO ] $texto" -ForegroundColor Yellow }
function Preguntar($texto, $defecto = "S") {
    if ($NoInteractivo) { return ($defecto -eq "S") }
    $r = Read-Host "$texto (S/N, Enter = $defecto)"
    if ([string]::IsNullOrWhiteSpace($r)) { $r = $defecto }
    return ($r.Trim().ToUpper() -eq "S")
}

Write-Host ""
Write-Host "  Agente de Impresión de Izao Perfumería - Instalación" -ForegroundColor White
Write-Host "  Se instalará en: $Destino"

if (-not [Environment]::Is64BitOperatingSystem) { throw "Este instalador necesita Windows de 64 bits." }
if (-not (Test-Path (Join-Path $origen "izao-agent.exe"))) { throw "No encuentro izao-agent.exe junto al instalador. Descomprima TODO el ZIP antes de instalar." }
if (-not (Test-Path (Join-Path $origen "SumatraPDF.exe"))) { throw "Falta SumatraPDF.exe en el paquete. Pida un paquete completo a quien lo preparó." }

# --- 1. Detener una instalación anterior
Paso 1 "Preparando la carpeta"
$exe = Join-Path $Destino "izao-agent.exe"
if (Test-Path $exe) {
    Aviso "Ya había una instalación. Se actualizará y se conservará su configuración."
    try { & $exe stop | Out-Null } catch { }
    Start-Sleep -Seconds 6
    Get-Process -Name "izao-agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

# --- 2. Copiar archivos (sin pisar config.yaml)
Paso 2 "Copiando los archivos"
Get-ChildItem -Path $origen -Force | Where-Object { $_.Name -notin @("config.yaml") } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $Destino -Recurse -Force
}
Ok "Archivos copiados a $Destino"

# --- 3. Configuración (impresora)
Paso 3 "Eligiendo la impresora de etiquetas"
$config = Join-Path $Destino "config.yaml"
if (-not (Test-Path $config)) {
    Copy-Item (Join-Path $Destino "config.example.yaml") $config
    $nueva = $true
} else { $nueva = $false; Ok "Se conserva su config.yaml actual." }

if ($nueva) {
    $lista = @()
    try { $lista = @(Get-Printer | Select-Object -ExpandProperty Name) } catch { }
    if ($Impresora -eq "" -and -not $NoInteractivo) {
        if ($lista.Count -eq 0) { Aviso "Windows no muestra impresoras instaladas. Instale la de etiquetas y vuelva a ejecutar este instalador." }
        else {
            Write-Host "  Impresoras que veo en este PC:"
            for ($i = 0; $i -lt $lista.Count; $i++) { Write-Host ("   {0}. {1}" -f ($i + 1), $lista[$i]) }
            $n = Read-Host "  Escriba el NÚMERO de la impresora de etiquetas"
            if ($n -match '^\d+$' -and [int]$n -ge 1 -and [int]$n -le $lista.Count) { $Impresora = $lista[[int]$n - 1] }
        }
    }
    $texto = Get-Content $config -Raw -Encoding UTF8
    if ($Impresora -ne "") {
        $texto = [regex]::Replace($texto, '(?m)^printer:.*$', ('printer: "' + $Impresora.Replace('"', '') + '"'))
        Ok "Impresora elegida: $Impresora"
    } else { Aviso "No se eligió impresora: abra $config con el Bloc de notas y escriba el nombre en la línea 'printer:'." }
    $texto = [regex]::Replace($texto, '(?m)^server_url:.*$', ('server_url: ' + $UrlServidor))
    [System.IO.File]::WriteAllText($config, $texto, (New-Object System.Text.UTF8Encoding($false)))
}

# --- 4. Token
Paso 4 "Guardando el token del agente"
if ($SinToken) { Aviso "Se omite el token (modo prueba)." }
else {
    $tienePrevio = $false
    if (-not $nueva) { & $exe doctor 2>$null | Select-String "Token guardado" | ForEach-Object { $tienePrevio = $true } }
    if ($tienePrevio -and -not (Preguntar "Ya hay un token guardado. ¿Quiere cambiarlo?" "N")) { Ok "Se conserva el token actual." }
    else {
        Write-Host "  Pegue el token que le dio el panel de la tienda (Agente > Crear agente)."
        Write-Host "  No se verá lo que pega; es normal. Después pulse Enter."
        $seguro = Read-Host "  Token" -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
        try {
            $plano = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
            # Por la entrada estándar: así el token nunca aparece en la lista de procesos ni en el historial.
            $plano | & $exe set-token --stdin
            if ($LASTEXITCODE -ne 0) { throw "No se pudo guardar el token. Revise que lo copió completo." }
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $plano = $null }
    }
}

# --- 5. Revisión
Paso 5 "Revisando que todo esté bien"
& $exe doctor
if (-not $NoInteractivo -and (Preguntar "¿Imprimir una página de prueba ahora?" "S")) { & $exe test-print }

# --- 6. Arranque automático
Paso 6 "Arranque automático al iniciar sesión"
$tarea = "Izao Agente de Impresion"
if ($SinTarea) { Aviso "Se omite la tarea programada (modo prueba)." }
else {
    $usuario = "$env:USERDOMAIN\$env:USERNAME"
    $accion = New-ScheduledTaskAction -Execute $exe -Argument "supervisor" -WorkingDirectory $Destino
    $disparador = New-ScheduledTaskTrigger -AtLogOn -User $usuario
    $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
    try {
        Register-ScheduledTask -TaskName $tarea -Action $accion -Trigger $disparador -Settings $ajustes -Principal $principal -Force | Out-Null
        Ok "Tarea programada creada: '$tarea' (se inicia sola cuando entre a Windows)."
    } catch {
        Aviso "No pude crear la tarea programada ($($_.Exception.Message)). Uso la carpeta Inicio de Windows."
        $atajo = Join-Path ([Environment]::GetFolderPath("Startup")) "Izao Agente de Impresion.lnk"
        $sh = New-Object -ComObject WScript.Shell
        $l = $sh.CreateShortcut($atajo); $l.TargetPath = $exe; $l.Arguments = "supervisor"; $l.WorkingDirectory = $Destino; $l.WindowStyle = 7; $l.Save()
        Ok "Acceso directo creado en la carpeta Inicio."
    }
}

# --- 7. Energía
Paso 7 "Que el PC no se duerma"
if ($SinEnergia) { Aviso "Se omite el plan de energía (modo prueba)." }
else {
    try {
        powercfg /change standby-timeout-ac 0 | Out-Null
        powercfg /change hibernate-timeout-ac 0 | Out-Null
        powercfg /change disk-timeout-ac 0 | Out-Null
        Ok "El PC no se suspenderá ni apagará el disco mientras esté enchufado."
    } catch { Aviso "No pude cambiar el plan de energía. Hágalo a mano (vea el README, paso 5)." }
}

# --- 8. Modo panel (opcional)
if (-not $SinChrome -and -not $NoInteractivo) {
    Paso 8 "Sesión en MasterShop (solo si usa el modo panel)"
    if (Preguntar "¿Quiere abrir Chrome ahora para iniciar sesión en MasterShop?" "N") {
        $url = Read-Host "  Dirección del panel de MasterShop (Enter = la que dé el servidor)"
        if ([string]::IsNullOrWhiteSpace($url)) { & $exe panel-login } else { & $exe panel-login --url $url }
    }
}

# --- 9. Arrancar
if (-not $SinTarea) {
    Start-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
    if (-not (Get-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue)) { Start-Process -FilePath $exe -ArgumentList "supervisor" -WorkingDirectory $Destino -WindowStyle Hidden }
}
Write-Host ""
Write-Host "  Listo. El agente quedó instalado y en marcha." -ForegroundColor Green
Write-Host "  Para comprobarlo, haga doble clic en Diagnostico.bat (carpeta $Destino)."
if (-not $NoInteractivo) { Read-Host "Pulse Enter para cerrar" | Out-Null }
