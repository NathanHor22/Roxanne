param(
  [string]$Port = "COM5",
  [switch]$Monitor,
  [switch]$ManualBootloader,
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

if ($ManualBootloader) {
  $esptool = Join-Path $pythonEnvironment "Scripts\esptool.exe"
  $arguments = @(
    "--chip", "esp32s3", "-p", $Port, "-b", "460800",
    "--before", "no_reset", "--after", "hard_reset", "write_flash",
    "--flash_mode", "dio", "--flash_freq", "80m", "--flash_size", "16MB"
  )
  if ($AppOnly) {
    $arguments += @("0x20000", "build\lantern.bin")
  } else {
    $arguments += @(
      "0x0", "build\bootloader\bootloader.bin",
      "0x20000", "build\lantern.bin",
      "0x8000", "build\partition_table\partition-table.bin",
      "0xd000", "build\ota_data_initial.bin"
    )
    $modelImage = "build\srmodels\srmodels.bin"
    if (Test-Path $modelImage) {
      $arguments += @("0x800000", $modelImage)
    }
  }
  & $esptool @arguments
} elseif ($Monitor) {
  idf.py -p $Port flash monitor
} else {
  idf.py -p $Port flash
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
