$ErrorActionPreference = "Stop"

$FirmwareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Components = Join-Path $FirmwareRoot "components"
$SdkRoot = Join-Path $Components "agora_iot_sdk"
$Archive = Join-Path $env:TEMP "roxanne-agora-iot-sdk.tar"

if (Test-Path (Join-Path $SdkRoot "include\agora_rtc_api.h")) {
  Write-Host "Agora IoT SDK is already installed."
  exit 0
}

New-Item -ItemType Directory -Force $SdkRoot | Out-Null
Invoke-WebRequest -Uri "https://rte-store.s3.amazonaws.com/agora_iot_sdk.tar" -OutFile $Archive
tar -xf $Archive -C $SdkRoot

$CmakeFile = Join-Path $SdkRoot "CMakeLists.txt"
$Cmake = Get-Content -Raw $CmakeFile
$Cmake = $Cmake.Replace([char]0xA0, " ")
$Cmake = $Cmake -replace '(add_prebuilt_library\(rtsa\s+"[^\r\n]+")\s+PRIV_REQUIRES[^\r\n]*\)', '$1 PRIV_REQUIRES lwip pthread)'
$Cmake = $Cmake -replace '(add_prebuilt_library\(ahpl\s+"[^\r\n]+")\s+PRIV_REQUIRES[^\r\n]*\)', '$1 PRIV_REQUIRES lwip pthread)'
[System.IO.File]::WriteAllText($CmakeFile, $Cmake)
Write-Host "Agora IoT SDK installed at $SdkRoot"
