# One-file Windows setup (#107)

[الخطوات واختبارات Windows بالعربية](ONE_FILE_SETUP.ar.md)

Unreleased work requested by the maintainer on 2026-10-23, from main `b46419c`.
No new release/version, browser-store submission or performance result is implied.

## Installation flow

Download one setup EXE, run it, choose English or Arabic, review the license and
installation directory, then install. The existing Tauri NSIS template retains
maintenance, DPI, RTL, keyboard, silent and per-user behavior. Original ZipZap
sidebar/header artwork and the existing icon replace generic branding; Segoe UI
and concise bilingual welcome/finish/progress messages explain the preparation.
`scripts/build-installer-art.ps1` regenerates both 24-bit BMPs from the existing
project icon and independently authored shapes; no new image dependency is used.

The package includes the full x64 Evergreen WebView2 installer, application,
native host, browser extension, Python/Node/yt-dlp media tools, notices and source
archives. Tauri reuses an installed WebView2 or runs the embedded installer
silently when absent. It does not fetch a bootstrapper on the user's machine.
This trades a larger download for offline prerequisite installation, following
[Tauri's supported mode](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)
and [Microsoft's deployment guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).
Normal Evergreen updates and online downloads/video extraction still use the
network. An incomplete EXE cannot run while it is downloading.

After copying files, `--prepare-install en|ar` initializes a fresh database using
the existing Manager and validation, resolving Downloads through Windows' known
folder API. It publishes only completed defaults without replacing an existing
database, then registers the existing native bridge. It starts no GUI, queue
workers, extraction process or test network request. A prepared new profile opens
directly into the app; optional setup remains in Settings. Existing databases are
not opened, migrated or rewritten by this command, including future/recovery
state and offline saved folders. Uninstall ownership/retention hooks are unchanged.

Initialization or registration failure shows localized recovery guidance. Installed
files do not imply successful preparation or a connected extension. The extension
is included, but current distribution requires loading it unpacked in the browser;
activation and per-site permissions need the user's approval. No policy sideload,
new service, startup/tray opt-in, or guessed browser readiness is introduced.

## Verification

Command-line regression tests cover fresh Arabic defaults with Unicode paths,
empty queue/no created download, existing/future database byte retention, unavailable
folder retention, invalid language and blocked initial folder. Installer lifecycle
tooling now verifies a real fresh preparation before its existing repair/retention
passes; that tool requires a disposable Windows user and is maintainer-run.

No prior acceptance report qualifies this newly changed installer.
Hosted checks remain skipped under #54. Existing #46/#47/#89 and M7 study gates
are not waived by this packaging change.

## Local candidate and results (2026-10-23)

Production build input: `f665447a6ccd9f580eb82d28a85da6f2dd1b06b3`.
Subsequent edits are documentation only. Required local checks passed:

- `npm run check`: five Node tests and zero Svelte errors/warnings.
- Rust fmt, workspace/all-target clippy with warnings denied, all 93 workspace
  tests and locked workspace build.
- Six historical comparison cases and all 48 engine scenarios, with verified
  fixture bytes; optional aria2 comparison skipped.
- Both PowerShell scripts parsed; the new embedded JavaScript verifier passed
  syntax checking. Original sidebar/header assets were generated and inspected.
- Release native/desktop/frontend/extension/NSIS builds passed. Extracted native
  bytes, all 46 media files, 13 extension files, five source archives and notices
  matched their inputs. Desktop bytes matched after only Tauri's documented
  three-byte `UNK` to `NSS` bundle marker substitution, as in the
  [previous candidate inspection](INSTALLED_BROWSER_QUALIFICATION.md).
- The embedded WebView2 offline installer matched the fetched input exactly:
  214,823,632 bytes, SHA-256
  `9b0142e22e8daa92855d746ae4d1e9eeef561ccaf67d1dd452165c4af3df3191`.
  Authenticode was **Valid**, signer **Microsoft Corporation**. Its installer
  ProductVersion is `1.3.299.15`; that is not an observed installed WebView2 version.

Local installer: `target/release/bundle/nsis/ZipZap_0.2.0-beta.1_x64-setup.exe`,
**258,809,630 bytes (246.82 MiB)**, Authenticode **NotSigned**, SHA-256:

`ccf16d07ffd46dc459deee88f7160eea4d4706f4cd9fae896d64fc5324e811eb`

Packaged desktop SHA-256:
`0fb790e072392f6097bd3792e54ff92c20de34f399e39ed5dd0621cf20a76409`.
Packaged native host SHA-256:
`574436b7e6f33fd55e3566f90ac8c7e1b18ec8744adc648c33443ac085638db7`.
License collection covers 380 entries; setup adds an explicit Microsoft runtime
terms/deployment notice alongside the existing CPython redistribution terms.
No Cargo/npm dependency version or lockfile changed.

Private build/check/extraction records are under `.research-local/closure-review/`.
The first private inspection helper could not load its signature module through
Windows PowerShell; rerunning it with PowerShell 7 completed the checks above.
That helper failure is not an installer failure or a passing first inspection.

The agent extracted and inspected the package without installing/executing it or
operating Windows UI. New interactive/offline/lifecycle acceptance below remains
maintainer-run and pending in draft PR #108. The candidate uses the existing beta
filename but does not replace the published beta. No version/tag/release or hosted
workflow was created, and no performance measurements were recorded.

## Grouped maintainer Windows checks

Run these together after the local checks/build are complete. Use a separate
Windows test user with no ZipZap state/registration, preserving personal data.

1. Fresh English and Arabic interactive install: brand assets, readable RTL and
   keyboard/DPI at 100%, 150%, 200%; clear license/directory/progress/final page.
   Preparation finishes before Finish. Open the app: the selected language and
   Windows Downloads folder work immediately without a required setup wizard.
2. Offline prerequisite case on a suitable disposable Windows environment without
   WebView2: turn off networking, install, then open the app. An existing WebView2
   should be reused on another run. Do not remove the shared runtime from a work
   computer. A failure must give recovery rather than false readiness.
3. Fresh silent install/repair/uninstall/reinstall retention with the existing
   guarded tool (no UI launch unless explicitly requested):

   ```powershell
   pwsh -File scripts/test-installer.ps1 -Installer target/release/bundle/nsis/ZipZap_0.2.0-beta.1_x64-setup.exe
   ```

4. Upgrade the published beta with synthetic settings/history/completed/partial
   files and an offline saved folder. Keep original language, queue, tray choices
   and files; no reset during upgrade or repair. Uninstall retains user data and
   shared WebView2, removing only the registration owned by this installation.
5. Settings can still open optional setup and repair failed registration. Browser
   extension activation and site permission refusal remain manual and truthful;
   no automatic test download or browser readiness is claimed by installing.

If a suitable absent-WebView2 environment is unavailable, report that case unrun.
No performance measurements or repeated earlier grouped tests are requested.
