# Native Windows desktop smoke test

This procedure exercises actual WebView2, Tauri commands, the shared Rust
Manager, SQLite and downloaded files. It complements the mocked IPC UI tests.
Use a local test build, never personal history or a normal browser profile.

## Prepare and repeat

1. Install the [development prerequisites](SETUP.md), run `npm ci`, then run
   `./scripts/prepare-desktop-smoke.ps1` from PowerShell in the repository.
   It builds the bundled frontend and debug desktop without an installer.
2. Keep the printed `run.json` path/metadata under `.research-local/native-smoke/`.
   Each preparation creates a unique `com.zipzap.smoke.<random-id>` identity,
   separate app state and a fresh downloads folder. The window starts with a
   780×560 client area. Reopen the same executable for restart tests; preparing
   again creates a different state. Record both source commit and dirty worktree.
3. Run `node scripts/e2e-fixture.mjs` in another terminal. Keep it running and use
   the URL and expected hashes in `.research-local/e2e-fixture.json`.
4. Launch the copied `zipzap-smoke.exe` named in `run.json`. It intentionally has
   no adjacent `zipzap-native.exe`, so startup cannot replace the normal Chrome/
   Edge registration. A browser-setup notice in Settings is expected. Do not
   install a sidecar or press **Connect Chrome / Edge** in this smoke session.
5. Use Settings and the native folder picker to choose `run.json`'s downloads
   folder. Set a 256 KiB/s shared limit so pause/restart/cancel remain observable.
   Save, reopen Settings and verify the values. Only isolated state is changed.
6. Add `<fixture-url>/manual-restart.bin`. Select its filename, pause, then resume
   consecutively without closing the app or waiting deliberately for worker exit.
   Verify progress continues. While downloading, close the window and reopen
   that same smoke executable. It must reopen Paused with its saved prefix;
   resume it and wait for Completed. Compare its SHA-256 to `manualSha256`.
   The deterministic core/headless regressions separately cover the worker-exit
   race; a human-paced UI sequence does not establish its precise timing.
7. Switch to Arabic. Add `<fixture-url>/smoke-note.txt` as `ملاحظة.txt`, submit
   with Enter and compare the completed file with `noteSha256`. Use **Open file**
   and **Show in folder**. Opening may show the OS app chooser if `.txt` has no
   default application; do not change file associations for this test. Explorer
   must open the isolated folder and select the correct completed file.
8. Remove that synthetic completed history entry. Verify its row disappears
   from both the UI and SQLite, while the completed file retains the same hash.
9. Add `<fixture-url>/manual-cancel.bin`, wait for transferred bytes, then cancel.
   Verify Cancelled is durable, no destination is published, and no
   `.zipzap-<job-id>.part*` remains. Reopen again to verify Arabic, folder/limit
   settings, Completed/Cancelled statuses and the removed row remain consistent.
10. At 780×560, inspect English and Arabic layout and the Windows accessibility
    tree. Check named buttons, fields, progress values, disabled/selected states,
    Tab/Shift+Tab focus, Enter/Space activation and Escape dismissal. Toolbar and
    table overflow can scroll; keyboard focus must reveal offscreen controls.
    Settings must remain usable through its vertical scroll area. Close the test
    app and fixture when done. Retain private evidence locally, outside Git.

Read SQLite only for assertions; do not inject jobs, replace Tauri IPC or use
page scripts to drive the app. Compare normal native-host registrations before
and after. Keep screenshots containing local paths, Explorer contents or other
desktop windows out of public evidence.

## Observed baseline: 2026-10-18, issue #29

Production source: `6568cc916da8b7e20abc61e0e648012eb4fa2b9a`. The preparation
script and text-fixture addition were in this issue's working tree; production
Rust/Svelte source was unchanged. Build overrides changed only the test identity,
window title/size and bundled sidecar list. Executable SHA-256:
`158ddca485808e6fdc8bdbc12a5f207579d6f801a83c58c4fcdc02c3c0217fcb`.

| Environment             | Observed version                                                   |
| ----------------------- | ------------------------------------------------------------------ |
| Windows                 | Windows 11 Pro x64, 10.0.26200, build 26200                        |
| Loaded WebView2         | 155.0.4283.62                                                      |
| Installed Chrome / Edge | 155.0.8059.80 / 155.0.4283.45; browser handoff was not tested here |
| Build tools             | Node 24.19.0, npm 11.17.0, Rust 1.99.0, Tauri CLI 2.12.3           |

| Actual check                                                            | Result                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Isolated build/start, real native folder picker, saved folder/256 KiB/s | Passed                                                                                |
| Add, pause, consecutive resume, progress and active-window close/reopen | Passed; reopened Paused with 7,168,000 saved bytes                                    |
| Resumed 16 MiB output                                                   | Completed; SHA-256 `01a12f59399d0486b14577e498d91675c69b35238726f44128ce4d4763544408` |
| Arabic filename and 69-byte UTF-8 text output                           | Completed; SHA-256 `dc49cf7c48c67220f49e419b76bfefdaec93dafec6b7b1e1df944b7066f37e00` |
| Open file                                                               | Reached the Windows application chooser; default association was left unchanged       |
| Show in folder                                                          | Explorer selected the correct 69-byte text file in the isolated folder                |
| Remove completed history                                                | Row removed from UI/SQLite; completed text file retained with exact hash              |
| Cancel an active second transfer                                        | Saved Cancelled; no output or owned partials remained                                 |
| Second reopen                                                           | Arabic, folder, limit, Completed/Cancelled states and history removal persisted       |
| Native accessibility and minimum layout                                 | English/Arabic controls, labels, progress and keyboard operations observed at 780×560 |
| Normal Chrome/Edge native registrations                                 | Values unchanged before/after                                                         |

The UI Automation helper reported the host pane as the focused element even
when a visible button/input had keyboard focus; focus rings and key activation
were checked visually. This baseline is not a full screen-reader certification.
External editor rendering, actual browser handoff, installer lifecycle and other
Windows versions were not tested here. No blocking product defect was observed
in this bounded baseline. Hosted checks were skipped by [policy](WORKFLOW.md).

## Windows provenance qualification: issue #44

Local Windows tests exercise actual alternate streams on temporary NTFS files:
publication with unchanged bytes, preservation of Restricted zone 4, stream-access
failure with a completed payload/advisory warning, reopen, and crash recovery that
restores a missing stream on the verified file. The engine fixture also checks
the exact marker and payload hash on every completed Windows download.

On 2026-10-19 the maintainer reported personally testing the Windows interface
and confirmed all requested manual scenarios, including the unmarked-file Open
warning's confirm/cancel and reveal paths. This is maintainer-reported acceptance,
not agent-observed Computer Use evidence. Further Computer Use was prohibited.
Automated UI tests independently check completed-byte warnings and explicit
reveal, with mocked IPC. Neither source of evidence certifies SmartScreen/AV
safety. Repeat the native paths against release #47's candidate using owned
harmless fixtures; do not change security settings or relabel personal files.

## Browser-result qualification: issue #43

Version 2 receipt/queued/rejected feedback has protocol, core/desktop and mocked
extension coverage, plus an actual host-process check of a missing companion
application using a temporary profile. On 2026-10-19 the maintainer reported
personally testing all requested manual scenarios, including Chrome/Edge
handoff with the app open and closed. This is maintainer-reported acceptance,
not agent-observed browser or Computer Use evidence. Further Computer Use was
prohibited. The first-beta browser evidence and #29 baseline are separate;
repeat the following checks against release #47's candidate.

Use the isolated identity/profile procedure with matching test host registration,
preserving normal registrations. In both Chrome and Edge and both languages,
test app closed/open, held queue, occupied destination/review, missing host,
unavailable app binary, receipt timeout and repeat delivery of one UUID. Confirm
receipt is visible before enqueue, held jobs wait and accepted output has the
fixture hash. Result files must contain only the version/UUID/state/safe code;
no private URL query, name or path. Close the popup during receipt and confirm
the app still consumes the request. Restore all isolated registrations afterward.

## Workspace qualification: issue #40

Appearance/column/context changes have automated browser and Rust coverage.
On 2026-10-19 the maintainer reported personally testing the Windows interface
and confirmed all requested manual scenarios, including English/Arabic,
keyboard operation and scaling. This is maintainer-reported acceptance,
not agent-observed Computer Use evidence. Further Computer Use was prohibited.
The historical #29 baseline is separate; repeat against release #47's candidate.

In a suitable isolated smoke session, verify light/dark/system contrast and
system changes, saved sorting and columns across reopen, slider keyboard resize,
filename availability and horizontal scrolling. Exercise right-click/Shift+F10
actions, errors/retry, context dismissal and focus after removal/filter changes.
Repeat in Arabic at 780×560, with long names and actual Windows/browser 200%
text scaling. Automated CSS zoom is separate evidence, not that native check.
Record the exact build and accessibility observations; do not change a personal
Windows session's scaling or drive device UI without authorization.

## Lifecycle qualification: issue #41

The lifecycle implementation has automated Rust and mocked IPC UI coverage.
Before review, native inspection was interrupted and these scenarios were
recorded as unexercised. On 2026-10-19 the maintainer reported testing the
Windows interface personally and confirmed all requested manual scenarios,
including tray close/show/quit, notifications and sleep/resume. This is
maintainer-reported acceptance, not agent-observed Computer Use evidence.
The maintainer prohibited further Computer Use. The #29 results above predate
this code; release #47 must qualify its own candidate, including OS sessions.

Repeat against the release candidate in an isolated Windows environment:

1. Start with fresh smoke state. Verify both preferences default off; closing
   checkpoints and exits. Reopen and verify saved bytes and output hashes.
2. Opt into close-to-tray, close during a bounded transfer and verify it keeps
   progressing. Show the window using the icon and menu, then launch the same
   executable again; verify one Manager/queue and no duplicate worker. Exercise
   Hold/Start from both UI and tray, including English/Arabic menu labels.
3. Quit through the tray and Settings during active work and retry waits;
   verify process exit, durable paused checkpoints and safe resume. Verify
   unavailable-tray/hide failures take the quit path where fault injection is
   available; automated UI fallback coverage alone is not native evidence.
4. Opt into notifications in isolated installed-app state. Complete/fail local
   fixtures and verify localized count-only payloads, five-second batching and
   no repeat on polling, opt-in or restart. Check Windows suppression and app
   identity separately; a debug toast or successful preparation is insufficient.
5. In a disposable Windows session/VM, test sleep/resume and sign-out/restart
   during transfer and retry wait. Reopen, inspect recovery and compare hashes.
   Record actual OS behavior and any defects. Never suspend, restart or sign out
   the maintainer's active host just to obtain evidence.

The maintainer's manual acceptance permits implementation review to finish.
Release #47 must retain this evidence distinction and repeat its candidate's
checks; headless, process-kill and mocked tests are not native observations.

## Queue schedule qualification: issue #42

On 2026-10-20, after agreeing to test the prepared isolated schedule build, the
maintainer reported that the test succeeded and explicitly requested merging
PR #74. The prepared implementation was `472569d`. This is maintainer-reported
native acceptance, not agent-observed Computer Use. No additional OS-session
times, per-scenario output or hashes were supplied, so none are inferred here.
Further Computer Use of the maintainer's active desktop remains prohibited.
Repeat the following in a disposable Windows session/VM for release #47:

1. Save a future one-shot window and queue a local fixture download. Verify it
   waits, starts once, finishes with the expected SHA-256, and stays complete on
   reopen. Verify English/Arabic local next-run labels, keyboard/error focus,
   dialog scrolling at 780×560 and saved weekly/overnight fields.
2. Choose a short weekly window. Manually Hold after its start; repeated polling
   must not restart it. At the scheduled hold, active work may finish but waiting
   jobs must remain queued. Tray menu Start/Hold must follow the shared state.
3. Sleep the disposable system across a start by more than 90 seconds and resume:
   the missed start must stay skipped. Start manually, sleep across a hold, and
   verify new dispatch is held on resume. Do not sleep the active work host.
4. Quit/reopen inside a window: no automatic catch-up. Re-enable/edit only when
   intentionally choosing a new future start. Record commit, OS, zone, actual
   sleep/start/hold times, queue results and output hashes, including failures.

Clock/zone mutation and physical sleep are not performed on the maintainer's
session by the automated fixtures. The release candidate must record its own
native acceptance; implementation acceptance does not qualify an installer.

## Support export qualification: issue #45

On 2026-10-20, after agreeing to test the isolated build from clean `ef2aa6f`,
the maintainer reported success and explicitly requested merging PR #75.
Executable SHA-256:
`ab23073b0d7f954350c9b6786ae240353090c7253bc26232587844e84a83b278`.
The requested checks were native save to a new filename, cancellation and
rejection of an existing file with its contents preserved. This is
maintainer-reported acceptance, not agent-observed Computer Use. No per-scenario
outputs or exported-file hashes were supplied; none are inferred here.
Release #47 must repeat the checks below on its candidate.

Core privacy tests, Windows filesystem save/error tests and mocked IPC UI tests
do not establish native dialog behavior. Prepare the isolated build above and
manually check, without Computer Use of the active desktop:

1. Open Support summary. Verify counts/codes and app/platform versions, with no
   URLs, filenames, usernames, local paths or raw errors. Close/reopen to refresh.
2. Export to a fresh JSON filename in the isolated downloads folder. Compare its
   contents with the displayed preview. Cancel a second native save dialog and
   verify no new summary file and a distinct cancellation message.
3. Select the existing export or an unwritable disposable destination. Verify a
   clear failure, unchanged original bytes and a retained preview for retry.
   Do not change personal-folder permissions. Export successfully to a new name.
4. Repeat dialog keyboard/focus/scroll checks in English and Arabic at 780×560.
   Record source commit, actual outcomes and any defects. Keep private paths and
   state outside Git. Implementation acceptance does not qualify an installer.
