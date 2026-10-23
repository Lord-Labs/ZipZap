param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$InstallDirectory = (Join-Path $PSScriptRoot '../.research-local/installer-smoke'),
  [switch]$UpgradeFromFirstBeta,
  [switch]$BrowserChecks
)
$ErrorActionPreference = 'Stop'
$zipzapInstallerPath = (Resolve-Path -LiteralPath $Installer).Path
$zipzapInstallPath = [IO.Path]::GetFullPath($InstallDirectory)
$zipzapWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $zipzapInstallPath.StartsWith(($zipzapWorkspace + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'Test install must stay inside the workspace' }
if (Test-Path -LiteralPath $zipzapInstallPath) { throw 'Choose a fresh test installation directory' }
if (Get-Process zipzap-desktop -ErrorAction SilentlyContinue) { throw 'Close ZipZap before installer verification' }
$zipzapState = Join-Path $env:LOCALAPPDATA 'com.zipzap.desktop'
if ((Test-Path -LiteralPath $zipzapState) -and @(Get-ChildItem -LiteralPath $zipzapState -Force).Count -gt 0) { throw 'Installer verification requires a disposable Windows user with no existing ZipZap state' }
$zipzapHostKeys = @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.zipzap.native','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.zipzap.native')
foreach($zipzapKey in $zipzapHostKeys) { if(Test-Path -LiteralPath $zipzapKey) { throw 'Installer verification must not replace existing browser registration' } }
New-Item -ItemType Directory -Path $zipzapState -Force | Out-Null
$zipzapDatabase = Join-Path $zipzapState 'zipzap.sqlite'
$zipzapRetainedFolder = Join-Path $zipzapWorkspace '.research-local/installer-downloads'
New-Item -ItemType Directory -Path $zipzapRetainedFolder -Force | Out-Null
if ($UpgradeFromFirstBeta) {
  $zipzapPrevious = Join-Path $zipzapRetainedFolder 'ZipZap_0.1.0-beta.1_x64-setup.exe'
  Invoke-WebRequest 'https://github.com/Lord-shaban/ZipZap/releases/download/v0.1.0-beta.1/ZipZap_0.1.0-beta.1_x64-setup.exe' -OutFile $zipzapPrevious
  if ((Get-FileHash -LiteralPath $zipzapPrevious -Algorithm SHA256).Hash.ToLowerInvariant() -ne '954ed29c5d9379799725954c2abfd8a80de92c9652d7cb72b3ecf3c7aa582969') { throw 'Published first-beta installer checksum differs' }
  $zipzapProcess = Start-Process -FilePath $zipzapPrevious -ArgumentList @('/S',('/D=' + $zipzapInstallPath)) -WindowStyle Hidden -Wait -PassThru
  if($zipzapProcess.ExitCode -ne 0) { throw 'First-beta installation failed' }
  if((Get-Item -LiteralPath (Join-Path $zipzapInstallPath 'zipzap-desktop.exe')).VersionInfo.ProductVersion -ne '0.1.0-beta.1') { throw 'Wrong first-beta installed version' }
  # Synthetic schema-1 records use the same fixture as the migration suite; no private history.
  $zipzapSeed = @'
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const [database, folder, fixture] = process.argv.slice(1);
const value = JSON.parse(readFileSync(fixture, 'utf8'));
const db = new DatabaseSync(database);
db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); PRAGMA user_version=1');
for (const job of value.jobs.slice(1)) {
  job.destination = path.join(folder, job.destination);
  if(job.status === 'downloading') {job.status='paused';job.downloaded=6;job.speed=0;}
  db.prepare('INSERT INTO jobs VALUES(?,?)').run(job.id,JSON.stringify(job));
  writeFileSync(job.status==='completed'?job.destination:path.join(folder,`.zipzap-${job.id}.part0`),'prefix');
}
db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify(value.settings));
assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n,2);
db.close();
'@
  & node --input-type=module -e $zipzapSeed $zipzapDatabase $zipzapRetainedFolder (Join-Path $zipzapWorkspace 'crates/zipzap-core/tests/fixtures/first-beta-state.json')
  if($LASTEXITCODE -ne 0) { throw 'Cannot create first-beta state fixture' }
} else {
  # Verify real fresh preparation before the retention/repair passes below.
  $zipzapProcess = Start-Process -FilePath $zipzapInstallerPath -ArgumentList @('/S',('/D=' + $zipzapInstallPath)) -WindowStyle Hidden -Wait -PassThru
  if($zipzapProcess.ExitCode -ne 0) { throw 'Fresh automatic installation failed' }
  $zipzapVerifyPrepared = @'
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const db = new DatabaseSync(process.argv[1], {readOnly:true});
try {
  assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n, 0);
  const settings = JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get().data);
  assert.ok(['en','ar'].includes(settings.language));
  assert.equal(typeof settings.download_folder, 'string');
  assert.ok(statSync(settings.download_folder).isDirectory());
  assert.equal(settings.close_to_tray, false);
  assert.equal(settings.notifications, false);
} finally { db.close(); }
'@
  & node --input-type=module -e $zipzapVerifyPrepared $zipzapDatabase
  if($LASTEXITCODE -ne 0) { throw 'Installer did not prepare safe defaults before application launch' }
  if(Get-Process zipzap-desktop -ErrorAction SilentlyContinue) { throw 'Silent setup launched the application unexpectedly' }
  Write-Output 'fresh automatic setup, empty queue and no GUI launch: passed'
}
$zipzapStateHash = (Get-FileHash -LiteralPath $zipzapDatabase).Hash
$zipzapRetainedFile = Join-Path $zipzapRetainedFolder ('retained-' + [Guid]::NewGuid().ToString() + '.txt')
Set-Content -LiteralPath $zipzapRetainedFile -Value 'ZipZap installer retention fixture' -Encoding utf8
$zipzapRetainedHash = (Get-FileHash -LiteralPath $zipzapRetainedFile).Hash
function Assert-ZipZapInstalled {
  foreach($zipzapName in @('zipzap-desktop.exe','zipzap-native.exe','THIRD_PARTY_LICENSES.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $zipzapInstallPath $zipzapName))) { throw "Missing installed file: $zipzapName" }
  }
  foreach($zipzapKey in $zipzapHostKeys) { if(-not (Test-Path -LiteralPath $zipzapKey)) { throw 'Native host registration missing' } }
  foreach($zipzapSource in (Get-ChildItem (Join-Path $zipzapWorkspace 'dist/release/sources') -Filter '*.crate' -File)) {
    $zipzapInstalledSource = Join-Path $zipzapInstallPath ('third-party-sources/' + $zipzapSource.Name)
    if((Get-FileHash -LiteralPath $zipzapInstalledSource).Hash -ne (Get-FileHash -LiteralPath $zipzapSource.FullName).Hash) { throw 'Bundled third-party source differs' }
  }
  $zipzapManifest = Get-Content -LiteralPath (Join-Path $zipzapState 'native-host.json') -Raw | ConvertFrom-Json
  if($zipzapManifest.path -ne (Join-Path $zipzapInstallPath 'zipzap-native.exe')) { throw 'Native registration points at another installation' }
  if((Get-FileHash -LiteralPath $zipzapDatabase).Hash -ne $zipzapStateHash) { throw 'Installer changed user state' }
  if((Get-FileHash -LiteralPath $zipzapRetainedFile).Hash -ne $zipzapRetainedHash) { throw 'Installer changed a retained download' }
  if($UpgradeFromFirstBeta) {
    foreach($zipzapOwnedFile in @('completed.bin','.zipzap-00000000-0000-4000-8000-000000000002.part0')) {
      if((Get-FileHash -LiteralPath (Join-Path $zipzapRetainedFolder $zipzapOwnedFile) -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'e7a2e8b216e5aec3facf743962d3997f2e7d70088ef257de472d6a258049832e') { throw 'Installer changed completed or partial fixture bytes' }
    }
  }
}
$zipzapFirstPass = if($UpgradeFromFirstBeta) { 'first-beta upgrade' } else { 'clean install' }
foreach($zipzapPass in @($zipzapFirstPass,'same-version upgrade/reinstall')) {
  $zipzapProcess = Start-Process -FilePath $zipzapInstallerPath -ArgumentList @('/S',('/D=' + $zipzapInstallPath)) -WindowStyle Hidden -Wait -PassThru
  if($zipzapProcess.ExitCode -ne 0) { throw "$zipzapPass failed: $($zipzapProcess.ExitCode)" }
  Assert-ZipZapInstalled
  Write-Output "${zipzapPass}: passed"
}
if($UpgradeFromFirstBeta) {
  $zipzapVerify = @'
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const [binary,database] = process.argv.slice(1);
const result=spawnSync(binary,[database],{input:'{"command":"jobs"}\n{"command":"settings"}\n{"command":"shutdown"}\n',encoding:'utf8',windowsHide:true});
assert.equal(result.status,0,result.stderr);
const answers=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
for(const answer of answers) assert.equal(answer.error,undefined);
assert.deepEqual(answers[0].result.map(job=>job.status),['paused','completed']);
assert.deepEqual(answers[0].result.map(job=>job.downloaded),[6,6]);
assert.equal(answers[1].result.language,'ar');
assert.equal(answers[1].result.speed_limit,65536);
const db=new DatabaseSync(database,{readOnly:true});
assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);
db.close();
'@
  & node --input-type=module -e $zipzapVerify (Join-Path $zipzapWorkspace 'target/debug/zipzap.exe') $zipzapDatabase
  if($LASTEXITCODE -ne 0) { throw 'Installed upgrade state migration failed' }
  $zipzapStateHash = (Get-FileHash -LiteralPath $zipzapDatabase).Hash
  Assert-ZipZapInstalled
  Write-Output 'published beta.1 installer upgrade, schema-1 fixture to schema-5, settings and owned bytes: passed'
}
if($BrowserChecks) {
  # Only fresh disposable state/registration passed the guards above.
  $zipzapBrowserSettings = @'
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [binary,database,folder]=process.argv.slice(1);
const run=input=>{const result=spawnSync(binary,[database],{input,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));};
const settings=run('{"command":"settings"}\n{"command":"shutdown"}\n')[0].result;
const answers=run(JSON.stringify({command:'settings',value:{...settings,download_folder:folder,close_to_tray:false,notifications:false,speed_limit:0}})+'\n{"command":"shutdown"}\n');
for(const answer of answers)assert.equal(answer.error,undefined);
'@
  & node --input-type=module -e $zipzapBrowserSettings (Join-Path $zipzapWorkspace 'target/debug/zipzap.exe') $zipzapDatabase $zipzapRetainedFolder
  if($LASTEXITCODE -ne 0) { throw 'Cannot prepare browser fixture settings' }
  $zipzapFixtureInfo = Join-Path $zipzapWorkspace '.research-local/e2e-fixture.json'
  if(Test-Path -LiteralPath $zipzapFixtureInfo) { throw 'Browser verification requires a fresh fixture workspace' }
  $zipzapFixtureProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(('"' + (Join-Path $zipzapWorkspace 'scripts/e2e-fixture.mjs') + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $zipzapRetainedFolder 'fixture.log') -RedirectStandardError (Join-Path $zipzapRetainedFolder 'fixture-errors.log')
  try {
    foreach($zipzapAttempt in 1..100) { if(Test-Path -LiteralPath $zipzapFixtureInfo) { break }; Start-Sleep -Milliseconds 100 }
    $zipzapFixture = Get-Content -LiteralPath $zipzapFixtureInfo -Raw | ConvertFrom-Json
    & node (Join-Path $zipzapWorkspace 'scripts/test-browser.mjs') $zipzapFixture.url $zipzapRetainedFolder
    if($LASTEXITCODE -ne 0) { throw 'Installed Chrome/Edge handoff failed' }
    foreach($zipzapAppProcess in @(Get-Process zipzap-desktop -ErrorAction SilentlyContinue)) {
      if([IO.Path]::GetFullPath($zipzapAppProcess.Path) -ne (Join-Path $zipzapInstallPath 'zipzap-desktop.exe')) { throw 'Unexpected desktop process during disposable verification' }
      if(-not $zipzapAppProcess.CloseMainWindow() -or -not $zipzapAppProcess.WaitForExit(15000)) { throw 'Installed app did not checkpoint and exit' }
    }
  } finally { if(-not $zipzapFixtureProcess.HasExited) { Stop-Process -Id $zipzapFixtureProcess.Id } }
  $zipzapStateHash = (Get-FileHash -LiteralPath $zipzapDatabase).Hash
  Assert-ZipZapInstalled
  Write-Output 'installed Chrome/Edge handoff, exact output bytes and checkpointed close: passed'
}
foreach($zipzapRemovalPass in 1..2) {
$zipzapUninstaller = Join-Path $zipzapInstallPath 'uninstall.exe'
$zipzapProcess = Start-Process -FilePath $zipzapUninstaller -ArgumentList @('/S',('_?=' + $zipzapInstallPath)) -WindowStyle Hidden -Wait -PassThru
if($zipzapProcess.ExitCode -ne 0) { throw 'Uninstall failed' }
foreach($zipzapKey in $zipzapHostKeys) { if(Test-Path -LiteralPath $zipzapKey) { throw 'Uninstall retained native host registration' } }
if(Test-Path -LiteralPath (Join-Path $zipzapState 'native-host.json')) { throw 'Uninstall retained host manifest' }
if(Test-Path -LiteralPath (Join-Path $zipzapInstallPath 'zipzap-desktop.exe')) { throw 'Uninstall retained application binary' }
if((Get-FileHash -LiteralPath $zipzapDatabase).Hash -ne $zipzapStateHash) { throw 'Uninstall changed user state' }
if((Get-FileHash -LiteralPath $zipzapRetainedFile).Hash -ne $zipzapRetainedHash) { throw 'Uninstall changed a download' }
if($UpgradeFromFirstBeta) {
  foreach($zipzapOwnedFile in @('completed.bin','.zipzap-00000000-0000-4000-8000-000000000002.part0')) {
    if((Get-FileHash -LiteralPath (Join-Path $zipzapRetainedFolder $zipzapOwnedFile) -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'e7a2e8b216e5aec3facf743962d3997f2e7d70088ef257de472d6a258049832e') { throw 'Uninstall changed completed or partial fixture bytes' }
  }
}
Write-Output 'uninstall, host cleanup, and retained database/download: passed'
if($zipzapRemovalPass -eq 1) {
  $zipzapProcess = Start-Process -FilePath $zipzapInstallerPath -ArgumentList @('/S',('/D=' + $zipzapInstallPath)) -WindowStyle Hidden -Wait -PassThru
  if($zipzapProcess.ExitCode -ne 0) { throw 'Reinstall after uninstall failed' }
  Assert-ZipZapInstalled
  Write-Output 'reinstall after uninstall retained state/completed/partial files: passed'
}
}
