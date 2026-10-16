param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$InstallDirectory = (Join-Path $PSScriptRoot '../.research-local/installer-smoke')
)
$ErrorActionPreference = 'Stop'
$zipzapInstallerPath = (Resolve-Path -LiteralPath $Installer).Path
$zipzapInstallPath = [IO.Path]::GetFullPath($InstallDirectory)
$zipzapWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $zipzapInstallPath.StartsWith(($zipzapWorkspace + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'Test install must stay inside the workspace' }
if (Test-Path -LiteralPath $zipzapInstallPath) { throw 'Choose a fresh test installation directory' }
if (Get-Process zipzap-desktop -ErrorAction SilentlyContinue) { throw 'Close ZipZap before installer verification' }
$zipzapState = Join-Path $env:LOCALAPPDATA 'com.zipzap.desktop'
New-Item -ItemType Directory -Path $zipzapState -Force | Out-Null
$zipzapDatabase = Join-Path $zipzapState 'zipzap.sqlite'
if (-not (Test-Path -LiteralPath $zipzapDatabase)) {
  '{"command":"shutdown"}' | & (Join-Path $zipzapWorkspace 'target/debug/zipzap.exe') $zipzapDatabase | Out-Null
  if($LASTEXITCODE -ne 0) { throw 'Cannot initialize fixture database' }
}
$zipzapStateHash = (Get-FileHash -LiteralPath $zipzapDatabase).Hash
$zipzapRetainedFolder = Join-Path $zipzapWorkspace '.research-local/installer-downloads'
New-Item -ItemType Directory -Path $zipzapRetainedFolder -Force | Out-Null
$zipzapRetainedFile = Join-Path $zipzapRetainedFolder ('retained-' + [Guid]::NewGuid().ToString() + '.txt')
Set-Content -LiteralPath $zipzapRetainedFile -Value 'ZipZap installer retention fixture' -Encoding utf8
$zipzapRetainedHash = (Get-FileHash -LiteralPath $zipzapRetainedFile).Hash
$zipzapHostKeys = @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.zipzap.native','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.zipzap.native')
function Assert-ZipZapInstalled {
  foreach($zipzapName in @('zipzap-desktop.exe','zipzap-native.exe','THIRD_PARTY_LICENSES.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $zipzapInstallPath $zipzapName))) { throw "Missing installed file: $zipzapName" }
  }
  foreach($zipzapKey in $zipzapHostKeys) { if(-not (Test-Path -LiteralPath $zipzapKey)) { throw 'Native host registration missing' } }
  $zipzapManifest = Get-Content -LiteralPath (Join-Path $zipzapState 'native-host.json') -Raw | ConvertFrom-Json
  if($zipzapManifest.path -ne (Join-Path $zipzapInstallPath 'zipzap-native.exe')) { throw 'Native registration points at another installation' }
  if((Get-FileHash -LiteralPath $zipzapDatabase).Hash -ne $zipzapStateHash) { throw 'Installer changed user state' }
  if((Get-FileHash -LiteralPath $zipzapRetainedFile).Hash -ne $zipzapRetainedHash) { throw 'Installer changed a retained download' }
}
foreach($zipzapPass in @('clean install','same-version upgrade/reinstall')) {
  $zipzapProcess = Start-Process -FilePath $zipzapInstallerPath -ArgumentList @('/S',('/D=' + $zipzapInstallPath)) -WindowStyle Hidden -Wait -PassThru
  if($zipzapProcess.ExitCode -ne 0) { throw "$zipzapPass failed: $($zipzapProcess.ExitCode)" }
  Assert-ZipZapInstalled
  Write-Output "${zipzapPass}: passed"
}
$zipzapUninstaller = Join-Path $zipzapInstallPath 'uninstall.exe'
$zipzapProcess = Start-Process -FilePath $zipzapUninstaller -ArgumentList @('/S',('_?=' + $zipzapInstallPath)) -WindowStyle Hidden -Wait -PassThru
if($zipzapProcess.ExitCode -ne 0) { throw 'Uninstall failed' }
foreach($zipzapKey in $zipzapHostKeys) { if(Test-Path -LiteralPath $zipzapKey) { throw 'Uninstall retained native host registration' } }
if(Test-Path -LiteralPath (Join-Path $zipzapState 'native-host.json')) { throw 'Uninstall retained host manifest' }
if(Test-Path -LiteralPath (Join-Path $zipzapInstallPath 'zipzap-desktop.exe')) { throw 'Uninstall retained application binary' }
if((Get-FileHash -LiteralPath $zipzapDatabase).Hash -ne $zipzapStateHash) { throw 'Uninstall changed user state' }
if((Get-FileHash -LiteralPath $zipzapRetainedFile).Hash -ne $zipzapRetainedHash) { throw 'Uninstall changed a download' }
Write-Output 'uninstall, host cleanup, and retained database/download: passed'
