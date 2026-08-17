# Removes the native messaging host registration created by install.ps1.

$ErrorActionPreference = "Stop"

$hostName = "jp.andent.open_local_gdrive"
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot "host\$hostName.json"
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (Test-Path $regPath) {
    Remove-Item -Path $regPath -Recurse -Force -Confirm:$false
    Write-Host "レジストリキーを削除しました: $regPath"
} else {
    Write-Host "レジストリキーは登録されていません: $regPath"
}

if (Test-Path $manifestPath) {
    Remove-Item -Path $manifestPath -Force -Confirm:$false
    Write-Host "host manifestを削除しました: $manifestPath"
}
