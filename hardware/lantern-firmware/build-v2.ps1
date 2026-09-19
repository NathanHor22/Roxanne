param(
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
$firmwareRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $firmwareRoot "..\..")).Path
$idfPath = Join-Path $repoRoot ".tools\esp-idf"
$espressifHome = Join-Path $env:USERPROFILE ".espressif"
$pythonEnvironment = Join-Path $espressifHome "python_env\idf5.2_py3.11_env"

if (-not (Test-Path (Join-Path $idfPath "tools\idf.py"))) {
  throw "ESP-IDF is missing at $idfPath"
}

$env:IDF_PATH = $idfPath
$env:IDF_TOOLS_PATH = $espressifHome
$env:IDF_PYTHON_ENV_PATH = $pythonEnvironment
$env:PATH = (Join-Path $pythonEnvironment "Scripts") + ";" + $env:PATH

. (Join-Path $idfPath "export.ps1")
$env:IDF_CCACHE_ENABLE = "0"
Set-Location $firmwareRoot

if ($Clean -and (Test-Path "build-v2")) {
  Remove-Item -LiteralPath "build-v2" -Recurse -Force
}

idf.py -B build-v2 `
  -D "SDKCONFIG=sdkconfig.v2" `
  -D "SDKCONFIG_DEFAULTS=sdkconfig.v2.defaults" `
  build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
