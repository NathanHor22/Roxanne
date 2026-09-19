param(
  [string]$Port = "COM10",
  [switch]$Monitor,
  [switch]$AppOnly
)

$ErrorActionPreference = "Stop"
$firmwareRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $firmwareRoot "..\..")).Path
$idfPath = Join-Path $repoRoot ".tools\esp-idf"
$espressifHome = Join-Path $env:USERPROFILE ".espressif"
$pythonEnvironment = Join-Path $espressifHome "python_env\idf5.2_py3.11_env"

$env:IDF_PATH = $idfPath
$env:IDF_TOOLS_PATH = $espressifHome
$env:IDF_PYTHON_ENV_PATH = $pythonEnvironment
$env:PATH = (Join-Path $pythonEnvironment "Scripts") + ";" + $env:PATH

. (Join-Path $idfPath "export.ps1")
$env:IDF_CCACHE_ENABLE = "0"
Set-Location $firmwareRoot

if ($AppOnly) {
  $esptool = Join-Path $pythonEnvironment "Scripts\esptool.exe"
  & $esptool --chip esp32s3 -p $Port -b 460800 `
    --before default_reset --after hard_reset write_flash `
    --flash_mode dio --flash_freq 80m --flash_size 16MB `
    0x20000 "build-v2\lantern.bin"
} else {
  $arguments = @(
    "-B", "build-v2",
    "-D", "SDKCONFIG=sdkconfig.v2",
    "-D", "SDKCONFIG_DEFAULTS=sdkconfig.v2.defaults",
    "-p", $Port,
    "flash"
  )
  if ($Monitor) { $arguments += "monitor" }
  idf.py @arguments
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
