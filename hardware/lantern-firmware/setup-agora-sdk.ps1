$ErrorActionPreference = "Stop"

$Installer = Join-Path $PSScriptRoot "..\firmware\setup-agora-sdk.ps1"
if (-not (Test-Path -LiteralPath $Installer)) {
  throw "Agora SDK installer was not found at $Installer"
}

& $Installer
exit $LASTEXITCODE
