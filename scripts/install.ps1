# Registers the native messaging host for the "Open Local for Google Drive"
# Chrome extension (current user only; no admin rights required).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ExtensionId <id>

param(
    # Stable ID derived from the "key" field in extension/manifest.json
    [string]$ExtensionId = "akmpfhnifeafnahlnfkhacjgcbeekgpo"
)

$ErrorActionPreference = "Stop"

if ($ExtensionId -notmatch '^[a-p]{32}$') {
    throw "Invalid extension ID: $ExtensionId (expected 32 chars of a-p)"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js が見つかりません。https://nodejs.org からインストールしてください"
}

$nodeVersion = (& node -v) -replace '^v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 24) {
    throw "Node.js 24以降が必要です (現在: v$nodeVersion)。node:sqlite を使用するためです。"
}

$hostName = "jp.andent.open_local_gdrive"
$repoRoot = Split-Path -Parent $PSScriptRoot
$hostDir = Join-Path $repoRoot "host"
$batPath = Join-Path $hostDir "open-local-host.bat"
$manifestPath = Join-Path $hostDir "$hostName.json"

if (-not (Test-Path $batPath)) {
    throw "ホストの起動スクリプトが見つかりません: $batPath"
}

$manifest = [ordered]@{
    name            = $hostName
    description     = "Open Local for Google Drive native messaging host"
    path            = $batPath
    type            = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json

# BOM-less UTF-8 (PowerShell 5.1's Set-Content -Encoding UTF8 adds a BOM,
# which some Chromium variants reject in host manifests)
[IO.File]::WriteAllText($manifestPath, $manifest)

$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Path $regPath -Force | Out-Null
Set-Item -Path $regPath -Value $manifestPath

Write-Host "登録が完了しました:"
Write-Host "  host manifest : $manifestPath"
Write-Host "  registry      : $regPath"
Write-Host "  extension ID  : $ExtensionId"
Write-Host ""
Write-Host "Chromeを再起動(または拡張機能をリロード)してからお使いください。"
