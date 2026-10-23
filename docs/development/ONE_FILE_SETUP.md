# One-file Windows setup (#107)

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

Build, required local checks and exact candidate evidence are recorded below once
complete. No prior acceptance report qualifies this newly changed installer.
Hosted checks remain skipped under #54. Existing #46/#47/#89 and M7 study gates
are not waived by this packaging change.

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
