# Build the actual desktop with an isolated identity, state and no native sidecar.
$ErrorActionPreference = 'Stop'
$zipzapRoot = Split-Path $PSScriptRoot -Parent
$zipzapRunId = [guid]::NewGuid().ToString('N')
$zipzapRun = Join-Path $zipzapRoot ".research-local/native-smoke/$zipzapRunId"
$zipzapIdentifier = "com.zipzap.smoke.$zipzapRunId"
$zipzapDownloads = Join-Path $zipzapRun 'downloads'
New-Item -ItemType Directory -Path $zipzapDownloads -Force | Out-Null
$zipzapBase = Get-Content (Join-Path $zipzapRoot 'apps/desktop/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$zipzapWindow = $zipzapBase.app.windows[0]
$zipzapWindow.title = 'ZipZap Smoke'
$zipzapWindow.width = 780
$zipzapWindow.height = 560
$zipzapConfig = @{
    identifier = $zipzapIdentifier
    app = @{ windows = @($zipzapWindow) }
    bundle = @{ externalBin = @() }
}
$zipzapConfigPath = Join-Path $zipzapRun 'tauri.smoke.json'
$zipzapConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $zipzapConfigPath -Encoding utf8
Push-Location (Join-Path $zipzapRoot 'apps/desktop')
try {
    & (Join-Path $zipzapRoot 'node_modules/.bin/tauri.cmd') build --debug --no-bundle --config $zipzapConfigPath
    if ($LASTEXITCODE -ne 0) { throw 'Smoke desktop build failed' }
} finally {
    Pop-Location
}
$zipzapBinary = Join-Path $zipzapRun 'zipzap-smoke.exe'
Copy-Item -LiteralPath (Join-Path $zipzapRoot 'target/debug/zipzap-desktop.exe') -Destination $zipzapBinary
if (Test-Path (Join-Path $zipzapRun 'zipzap-native.exe')) { throw 'Smoke directory must not contain a native host' }
$zipzapMetadata = @{
    runFile = Join-Path $zipzapRun 'run.json'
    sourceCommit = (& git -C $zipzapRoot rev-parse HEAD)
    worktree = @(& git -C $zipzapRoot status --short)
    identifier = $zipzapIdentifier
    executable = $zipzapBinary
    sha256 = (Get-FileHash -LiteralPath $zipzapBinary -Algorithm SHA256).Hash.ToLowerInvariant()
    stateFolder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $zipzapIdentifier
    downloads = $zipzapDownloads
    window = @{ width = 780; height = 560 }
}
$zipzapMetadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $zipzapRun 'run.json') -Encoding utf8
$zipzapMetadata | ConvertTo-Json -Depth 5
