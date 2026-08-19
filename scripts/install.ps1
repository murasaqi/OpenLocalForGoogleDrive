# Registers the native messaging host for the "Open Local for Google Drive"
# Chrome extension (registration itself is current user only; no admin rights
# required). If Node.js 24+ is missing, attempts to install it via winget
# (UAC approval may be required for that step only).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ExtensionId <id>
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -SkipNodeInstall

param(
    # Stable ID derived from the "key" field in extension/manifest.json
    [string]$ExtensionId = "akmpfhnifeafnahlnfkhacjgcbeekgpo",
    # Skip the automatic Node.js installation (for CI or manually managed setups)
    [switch]$SkipNodeInstall
)

$ErrorActionPreference = "Stop"
$requiredNodeMajor = 24

if ($ExtensionId -notmatch '^[a-p]{32}$') {
    throw "Invalid extension ID: $ExtensionId (expected 32 chars of a-p)"
}

function Get-NodeVersionString {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }
    return ((& node -v) -replace '^v', '')
}

function Get-NodeMajorVersion {
    $version = Get-NodeVersionString
    if (-not $version) { return $null }
    $major = 0
    if ([int]::TryParse($version.Split('.')[0], [ref]$major)) { return $major }
    return $null
}

function Update-SessionPath {
    # Reflect PATH changes made by the installer into the current session
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

function Install-NodeLts {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw ("winget が見つからないため Node.js を自動インストールできません。" +
            "https://nodejs.org から Node.js $requiredNodeMajor 以降をインストールして再実行してください。")
    }
    Write-Host "Node.js $requiredNodeMajor 以降が見つかりません。winget でインストールします (UACの承認を求められる場合があります)..."
    winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw ("winget による Node.js のインストールに失敗しました (exit code: $LASTEXITCODE)。" +
            "https://nodejs.org から手動でインストールするか、「winget install --id OpenJS.NodeJS.LTS」を実行してください。")
    }
    Update-SessionPath
}

$nodeMajor = Get-NodeMajorVersion
if ($null -eq $nodeMajor -or $nodeMajor -lt $requiredNodeMajor) {
    $current = Get-NodeVersionString
    if ($current) { $currentLabel = "現在: v$current" } else { $currentLabel = "未インストール" }
    if ($SkipNodeInstall) {
        throw ("Node.js $requiredNodeMajor 以降が必要です ($currentLabel)。node:sqlite を使用するためです。" +
            "「winget install --id OpenJS.NodeJS.LTS」または https://nodejs.org からインストールしてください。")
    }
    Install-NodeLts
    $nodeMajor = Get-NodeMajorVersion
    if ($null -eq $nodeMajor -or $nodeMajor -lt $requiredNodeMajor) {
        throw ("Node.js をインストールしましたが、このセッションから Node.js $requiredNodeMajor 以降を検出できません。" +
            "新しいターミナルを開いて install.ps1 を再実行してください。")
    }
    Write-Host "Node.js v$(Get-NodeVersionString) をインストールしました。"
}

# Verify that node:sqlite (required by the host) actually loads
& node --no-warnings -e "require('node:sqlite')"
if ($LASTEXITCODE -ne 0) {
    throw ("この Node.js (v$(Get-NodeVersionString)) では node:sqlite を利用できません。" +
        "「winget install --id OpenJS.NodeJS.LTS」で Node.js $requiredNodeMajor 以降に更新してください。")
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
Write-Host "  Node.js       : v$(Get-NodeVersionString)"
Write-Host "  host manifest : $manifestPath"
Write-Host "  registry      : $regPath"
Write-Host "  extension ID  : $ExtensionId"
Write-Host ""
Write-Host "Chromeを再起動(または拡張機能をリロード)してからお使いください。"
