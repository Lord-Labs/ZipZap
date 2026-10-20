# Exercise collector refusal paths without launching an application or touching real state.
$ErrorActionPreference = 'Stop'
$zipzapTestId = [guid]::NewGuid().ToString('N')
$zipzapRoot = Split-Path $PSScriptRoot -Parent
$zipzapFixture = Join-Path $zipzapRoot ".research-local/native-smoke/$zipzapTestId"
$zipzapState = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "com.zipzap.smoke.$zipzapTestId"
$zipzapExe = Join-Path $zipzapFixture 'zipzap-smoke.exe'
$zipzapRun = Join-Path $zipzapFixture 'run.json'
New-Item -ItemType Directory -Path $zipzapFixture | Out-Null
# This is deliberately not an executable, even if a guard regresses.
'collector guard fixture; never executable' | Set-Content -LiteralPath $zipzapExe
$zipzapMetadata = @{
    identifier = "com.zipzap.smoke.$zipzapTestId"; profile = 'release'
    executable = $zipzapExe; stateFolder = $zipzapState
    sha256 = (Get-FileHash -LiteralPath $zipzapExe -Algorithm SHA256).Hash
    sourceCommit = 'guard-fixture'
}
function Assert-ZipzapRefusal([string]$Expected) {
    $zipzapMetadata | ConvertTo-Json | Set-Content -LiteralPath $zipzapRun
    try {
        & (Join-Path $PSScriptRoot 'measure-native-performance.ps1') -RunFile $zipzapRun -HistoryDirectory $zipzapFixture
        throw 'Collector accepted invalid input'
    } catch {
        if ($_.Exception.Message -ne $Expected) { throw }
        Write-Host "PASS: $Expected"
    }
}
try {
    $zipzapMetadata.profile = 'debug'
    Assert-ZipzapRefusal 'Prepare a new isolated release build; normal/debug app state is not accepted.'
    $zipzapMetadata.profile = 'release'
    $zipzapMetadata.executable = Join-Path $zipzapFixture 'unrelated.exe'
    Assert-ZipzapRefusal 'Unexpected isolated executable path'
    $zipzapMetadata.executable = $zipzapExe
    $zipzapMetadata.stateFolder = Join-Path $zipzapFixture 'unrelated-state'
    Assert-ZipzapRefusal 'Unexpected state folder'
    $zipzapMetadata.stateFolder = $zipzapState
    $zipzapOriginalHash = $zipzapMetadata.sha256
    $zipzapMetadata.sha256 = 'changed'
    Assert-ZipzapRefusal 'Executable hash changed'
    $zipzapMetadata.sha256 = $zipzapOriginalHash
    'not an executable' | Set-Content -LiteralPath (Join-Path $zipzapFixture 'zipzap-native.exe')
    Assert-ZipzapRefusal 'Isolated build must have no browser sidecar'
    Remove-Item -LiteralPath (Join-Path $zipzapFixture 'zipzap-native.exe')
    New-Item -ItemType Directory -Path $zipzapState | Out-Null
    Assert-ZipzapRefusal 'Use a newly prepared identity with no existing state'
    Remove-Item -LiteralPath $zipzapState
    '{"sourceCommit":"different-fixture"}' | Set-Content -LiteralPath (Join-Path $zipzapFixture 'results.json')
    Assert-ZipzapRefusal 'Native and engine/UI measurements must use the same source commit'
    '{"sourceCommit":"guard-fixture"}' | Set-Content -LiteralPath (Join-Path $zipzapFixture 'results.json')
    Assert-ZipzapRefusal 'Missing synthetic history'
} finally {
    # Only named fixture files and empty directories; never recursively remove app state.
    foreach ($zipzapName in @('zipzap-smoke.exe', 'zipzap-native.exe', 'run.json', 'results.json')) {
        $zipzapFile = Join-Path $zipzapFixture $zipzapName
        if (Test-Path -LiteralPath $zipzapFile) { Remove-Item -LiteralPath $zipzapFile }
    }
    if (Test-Path -LiteralPath $zipzapState) { Remove-Item -LiteralPath $zipzapState }
    Remove-Item -LiteralPath $zipzapFixture
}
