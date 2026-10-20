# Human-run collector for #46. No window/input automation, registry changes or cache flush.
param(
    [Parameter(Mandatory)][string]$RunFile,
    [Parameter(Mandatory)][string]$HistoryDirectory,
    [switch]$ColdBoot
)
$ErrorActionPreference = 'Stop'
$zipzapMetadata = Get-Content -LiteralPath $RunFile -Raw | ConvertFrom-Json
if ($zipzapMetadata.identifier -notmatch '^com\.zipzap\.smoke\.[a-f0-9]{32}$' -or $zipzapMetadata.profile -ne 'release') {
    throw 'Prepare a new isolated release build; normal/debug app state is not accepted.'
}
$zipzapExe = [IO.Path]::GetFullPath($zipzapMetadata.executable)
$zipzapRunId = $zipzapMetadata.identifier.Substring('com.zipzap.smoke.'.Length)
$zipzapExpectedExe = Join-Path (Split-Path $PSScriptRoot -Parent) ".research-local/native-smoke/$zipzapRunId/zipzap-smoke.exe"
if ($zipzapExe -ne [IO.Path]::GetFullPath($zipzapExpectedExe)) { throw 'Unexpected isolated executable path' }
$zipzapExpectedState = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $zipzapMetadata.identifier
if ([IO.Path]::GetFullPath($zipzapMetadata.stateFolder) -ne $zipzapExpectedState) { throw 'Unexpected state folder' }
if ((Get-FileHash -LiteralPath $zipzapExe -Algorithm SHA256).Hash -ne $zipzapMetadata.sha256) { throw 'Executable hash changed' }
if (Test-Path (Join-Path (Split-Path $zipzapExe) 'zipzap-native.exe')) { throw 'Isolated build must have no browser sidecar' }
if (Test-Path -LiteralPath $zipzapExpectedState) { throw 'Use a newly prepared identity with no existing state' }
$zipzapHistory = [IO.Path]::GetFullPath($HistoryDirectory)
$zipzapBaseline = Get-Content -LiteralPath (Join-Path $zipzapHistory 'results.json') -Raw | ConvertFrom-Json
if ($zipzapMetadata.sourceCommit -ne $zipzapBaseline.sourceCommit) { throw 'Native and engine/UI measurements must use the same source commit' }
foreach ($zipzapCount in @(100, 1000)) {
    if (-not (Test-Path -LiteralPath (Join-Path $zipzapHistory "history-$zipzapCount.sqlite"))) { throw 'Missing synthetic history' }
}
New-Item -ItemType Directory -Path $zipzapExpectedState | Out-Null
$zipzapSamples = @()
$zipzapWebViewVersion = $null
$zipzapNativeHost = @{
    os = [Environment]::OSVersion.VersionString
    cpu = @(Get-CimInstance Win32_Processor | ForEach-Object { $_.Name })
    ramBytes = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
    logicalCpus = [Environment]::ProcessorCount
    powershell = $PSVersionTable.PSVersion.ToString()
}
foreach ($zipzapCount in @(100, 1000)) {
    # Generated through normal core add-for-later calls, never personal history.
    Copy-Item -LiteralPath (Join-Path $zipzapHistory "history-$zipzapCount.sqlite") -Destination (Join-Path $zipzapExpectedState 'zipzap.sqlite')
    foreach ($zipzapRepeat in 1..3) {
        Write-Host "Rows=$zipzapCount run=$zipzapRepeat. Wait for all rows, press Enter, then search fixture-0000.bin, clear, sort and scroll in English/Arabic. Close the app after sampling."
        $zipzapWatch = [Diagnostics.Stopwatch]::StartNew()
        $zipzapProcess = Start-Process -FilePath $zipzapExe -PassThru -WindowStyle Normal
        # Handle-ready is not painted-ready; preserve both timing definitions.
        while ($zipzapProcess.MainWindowHandle -eq 0) {
            if ($zipzapProcess.HasExited -or $zipzapWatch.Elapsed.TotalSeconds -gt 30) { throw 'Window did not become ready' }
            Start-Sleep -Milliseconds 20
            $zipzapProcess.Refresh()
        }
        $zipzapHandleMs = $zipzapWatch.Elapsed.TotalMilliseconds
        Read-Host 'Press Enter only when the table is visible' | Out-Null
        $zipzapHumanReadyMs = $zipzapWatch.Elapsed.TotalMilliseconds
        $zipzapRunSamples = @()
        foreach ($zipzapSecond in 1..20) {
            $zipzapProcesses = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
            # A warm WebView browser may outlive its original parent; include only this random profile.
            $zipzapOwned = @([int]$zipzapProcess.Id) + @($zipzapProcesses | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$($zipzapMetadata.identifier)*" } | ForEach-Object { [int]$_.ProcessId })
            $zipzapOwned = @($zipzapOwned | Select-Object -Unique)
            do {
                $zipzapPrevious = $zipzapOwned.Count
                $zipzapOwned += @($zipzapProcesses | Where-Object { $_.ParentProcessId -in $zipzapOwned -and $_.ProcessId -notin $zipzapOwned } | ForEach-Object { [int]$_.ProcessId })
            } while ($zipzapOwned.Count -ne $zipzapPrevious)
            $zipzapMetrics = @()
            foreach ($zipzapOwnedId in $zipzapOwned) {
                $zipzapMeasured = Get-Process -Id $zipzapOwnedId -ErrorAction SilentlyContinue
                if ($null -eq $zipzapMeasured) { continue }
                if ($zipzapOwnedId -ne $zipzapProcess.Id -and $zipzapMeasured.ProcessName -ne 'msedgewebview2') { continue }
                if ($zipzapMeasured.ProcessName -eq 'msedgewebview2' -and $null -eq $zipzapWebViewVersion) {
                    $zipzapWebViewVersion = $zipzapMeasured.MainModule.FileVersionInfo.FileVersion
                }
                $zipzapMetrics += @{
                    pid = $zipzapOwnedId
                    group = $(if ($zipzapOwnedId -eq $zipzapProcess.Id) { 'app-core' } else { 'webview2' })
                    workingSetBytes = $zipzapMeasured.WorkingSet64
                    privateBytes = $zipzapMeasured.PrivateMemorySize64
                    cpuSeconds = $zipzapMeasured.TotalProcessorTime.TotalSeconds
                }
            }
            if (-not ($zipzapMetrics | Where-Object { $_.group -eq 'app-core' })) { throw 'App exited during sampling' }
            if (-not ($zipzapMetrics | Where-Object { $_.group -eq 'webview2' })) { throw 'No isolated WebView2 process found; measurement is incomplete' }
            $zipzapRunSamples += @{ elapsedMs = $zipzapWatch.Elapsed.TotalMilliseconds; processes = $zipzapMetrics }
            Start-Sleep -Seconds 1
        }
        $zipzapObservation = Read-Host 'Record visible row count, language, search/sort/scroll result and any delay/error; close ZipZap before pressing Enter'
        if (-not $zipzapProcess.WaitForExit(30000)) { throw 'Close only the isolated test app before continuing' }
        $zipzapSamples += @{
            rows = $zipzapCount; repetition = $zipzapRepeat
            startupKind = $(if ($ColdBoot -and $zipzapCount -eq 100 -and $zipzapRepeat -eq 1) { 'operator-reported first app launch after boot; fresh profile' } elseif ($zipzapCount -eq 100 -and $zipzapRepeat -eq 1) { 'fresh profile; OS cache unknown' } else { 'warm reopen' })
            windowHandleReadyMs = $zipzapHandleMs; humanTableReadyMs = $zipzapHumanReadyMs
            samples = $zipzapRunSamples; operatorObservation = $zipzapObservation
        }
        # Save incrementally so a failed later run does not discard earlier evidence.
        @{
            date = [DateTime]::UtcNow.ToString('o'); sourceCommit = $zipzapMetadata.sourceCommit
            executableSha256 = $zipzapMetadata.sha256; profile = $zipzapMetadata.profile
            collectorSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
            webview2 = $zipzapWebViewVersion; environment = $zipzapNativeHost
            limits = 'Human timing includes reaction time. Handle-ready is not painted-ready. 1s sampling can miss peaks; working sets share pages and must not be called unique physical RAM. Collector overhead is excluded. No UI automation or OS cache flush.'
            runs = $zipzapSamples
        } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $zipzapHistory 'native-results.json') -Encoding utf8
    }
}
Write-Host "Saved local native-results.json. Review observations for private text before sharing."
