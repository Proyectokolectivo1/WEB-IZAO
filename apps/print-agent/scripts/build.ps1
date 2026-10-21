# Empaqueta el agente: PyInstaller (izao-agent.exe) + SumatraPDF portable + instalador -> release\IzaoAgent-<versión>.zip
# Uso (desde apps\print-agent):   powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#
# SumatraPDF: descargue el ZIP "portable" de 64 bits desde https://www.sumatrapdfreader.org/download-free-pdf-viewer,
# descomprímalo, renombre el .exe a SumatraPDF.exe y déjelo en apps\print-agent\vendor\. Verifique la firma/huella
# publicada en el sitio oficial. No se descarga automáticamente a propósito.
param([switch]$OmitirPruebas)
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

$venv = Join-Path $raiz ".venv"
if (-not (Test-Path $venv)) { py -3.12 -m venv $venv }
$py = Join-Path $venv "Scripts\python.exe"
& $py -m pip install -q -r requirements-dev.txt
if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar las dependencias." }

if (-not $OmitirPruebas) {
    & $py -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw "Las pruebas fallaron; no se empaqueta." }
}

$sumatra = Join-Path $raiz "vendor\SumatraPDF.exe"
if (-not (Test-Path $sumatra)) { throw "Falta vendor\SumatraPDF.exe (vea las instrucciones al inicio de este script)." }

$version = (& $py -c "import izao_agent; print(izao_agent.__version__)").Trim()
Remove-Item (Join-Path $raiz "build"), (Join-Path $raiz "dist") -Recurse -Force -ErrorAction SilentlyContinue
& $py -m PyInstaller --noconfirm --clean --onedir --name izao-agent --console `
    --collect-all playwright --hidden-import win32print --hidden-import win32timezone --hidden-import keyring.backends.Windows `
    --exclude-module tkinter --exclude-module pytest `
    --distpath dist --workpath build --specpath build packaging\entry.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller falló." }

$salida = Join-Path $raiz "release\IzaoAgent-$version"
Remove-Item $salida -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $salida | Out-Null
Copy-Item "dist\izao-agent\*" $salida -Recurse
Copy-Item $sumatra $salida
Copy-Item "config.example.yaml" $salida
Copy-Item "packaging\*.bat", "packaging\*.ps1" $salida
Copy-Item "README.md" $salida
$zip = "$salida.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$salida\*" -DestinationPath $zip
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
Write-Host "Listo: $zip"
Write-Host "SHA-256: $hash"
