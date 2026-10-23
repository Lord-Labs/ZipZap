# Installed-browser runner qualification (#82)

The original run 39527944143 remains cancelled. Its log stops after Chromium's
verified transfer, before invalid-input/browser-close/Edge results. That log
does not establish the precise blocking call or a production root cause.

## Current diagnosis and fix

On 2026-10-23 a disposable native-host/Tauri fixture reproduced a completed
download while the Chrome popup still waited for success and browser close
timed out. The app heartbeat, queued receipt and completed output existed;
this was not evidence that the GUI failed to start. These failed runs do not
qualify the corrected candidate or Edge.

The old launcher cleared inheritance on the three standard handles, then used
`Command::spawn`, which can inherit other handles. A command-line regression
passed a separate inheritable event through the native host into a non-UI
fixture. The child could signal that event before the fix, proving that handle
leak independently of the browser. The strengthened test also checks response
EOF while the fixture stays alive, missing-app behavior and launch from a path
containing spaces and Arabic characters.

The Windows launcher now calls `CreateProcessW` with handle inheritance disabled,
an explicit absolute application path and only the fixed background flag when
requested. It closes its process/thread handles, preserves launch-failure
receipts and adds no shell invocation. It reuses the existing pinned
windows-sys dependency; no new crate/version is introduced. The corresponding
regression failed before this change and passed afterward. This is a verified
handle-boundary fix; its effect on the actual browser stall still requires the
installed-browser run below.

The runner reports bounded launch, extension-load, transfer, invalid-link and
close stages. It emits a pass only after all stages finish. On close failure it
stops only the browser tree with this run's exact randomly generated profile,
preserving the original and cleanup failures. The cleanup regression deliberately
blocks close; its earlier PID-presence assertion was insufficient because an
exited process can retain an observable process object. It now waits for process
exit. The corrected real-browser cleanup check remains pending.

## Local verification and candidate

Build input: `980c0787ade8e57d406bddbb5efeb1f45146c76c`, 2026-10-23.
Later edits affect only test bounds, checklists and evidence, not production source.

- `npm run check`, Rust formatting, workspace/all-target clippy with warnings
  denied, all 90 workspace tests and locked workspace build passed.
- Six historical comparison cases and 48 production-engine cases passed with
  verified bytes. Optional aria2 comparison was skipped. The built capture
  worker's consent, phase/restart/failure/retention/privacy checks also passed;
  these use controlled transport, not actual browser consent.
- npm and Cargo audits found zero vulnerability advisories. Cargo retains five
  informational warnings (proc-macro-error, zbus_names, zvariant,
  zvariant_derive and glib); all are absent from the resolved Windows closure.
  No warning suppression or dependency-policy change was made.
- Release desktop/sidecar/frontend/NSIS build passed. Extracted sidecar bytes,
  all 46 media resources, 13 extension files, five source archives and notices
  matched build inputs. The desktop matched after the single documented
  `UNK` to `NSS` bundle marker substitution: exactly three differing bytes.
  [Pinned Tauri CLI source](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-bundler/src/bundle.rs)
  patches for NSIS, then restores the unpackaged binary. An initial raw equality
  assertion failed on that marker; no other difference was accepted.

Local installer: **41,194,390 bytes**, Authenticode **NotSigned**, SHA-256
`33e231e5071842f5076a03cb6c7e9fb95f2eaf744f725c12d356f70b85d72f29`.
Packaged native host SHA-256:
`469eeedd39398bf26c0986666952349fdfecd0af7ed43971397e48319aafb133`.
It is an unreleased local candidate under the existing beta filename, not a
replacement for the published beta. It was extracted and checked, not installed
or executed. Private build/audit/package records remain under
`.research-local/closure-review/`.

## User-run Windows checks

The [complete grouped Arabic checklist](WINDOWS_MANUAL_CHECKLIST.ar.md) includes
browser, capture/video, installer/setup/permissions and startup evidence. Run and
report the groups together at the maintainer's chosen time.

The maintainer requested on 2026-10-23 to perform tests needing Windows control
personally. Do not run these UI checks on their behalf. No VM is required for
the two isolated commands below. They require installed Chrome, Edge, WebView2,
the repository dependencies and Rust build tools.

From the repository root in PowerShell, with other ZipZap builds/tests finished:

```powershell
New-Item -ItemType Directory -Path .research-local/closure-review -Force | Out-Null
node scripts/test-installed-browsers.mjs *> .research-local/closure-review/windows-browser-user.log
Get-Content .research-local/closure-review/windows-browser-user.log -Tail 40
node --test scripts/test-browser-cleanup.test.mjs *> .research-local/closure-review/windows-cleanup-user.log
Get-Content .research-local/closure-review/windows-cleanup-user.log -Tail 30
```

The first builds a private app identity, host name, state, output directory and
extension copy. It preserves ordinary native registration, checks Chrome then
Edge handoff/invalid-input/close, verifies every fixture output SHA-256 and
quits only the private app. Its retained `results.json` must report both browsers,
native launch, close and unchanged ordinary registration as passed. The second
uses an unregistered private host and a deliberately blocked close to verify
bounded cleanup and preservation of the handoff error. A nonzero exit, timeout,
missing browser result or surviving private process is a failure, not a pass.

Share the last lines above and the generated result path. Review raw logs before
sharing; retained browser profiles, binaries, state and full logs stay ignored.

## Remaining platform gates

Keep #82 open until both corrected browser runs pass. Keep #46/#47/#88/#89 and
full #51 open where their acceptance is still missing. This runner uses a private
identity, not production-identity installed qualification.

- #46: three independently recorded first app launches after real Windows boots,
  warm reopens, visible/painted readiness and resource/100/1000-row measurements.
  Follow [the performance procedure](../research/performance.md); a new profile
  is not a cold boot. Do not reboot the active host automatically.
- #88/#89/#47: production installer, published-beta upgrade, repair,
  uninstall/reinstall with retained state/files, actual permission refusal/revoke,
  English/Arabic interactive installer, and WebView2-absent/offline behavior.
  Follow [release qualification](RELEASING.md) in a disposable Windows user/session.
  The existing installer script refuses personal state/registration. No such
  isolated environment is assumed available, and these checks are deferred.
- Capture/video: retain the specific approved fixtures and the limits in
  [capture evidence](CAPTURE_PROTOCOL.md) and [video evidence](VIDEO_ACTION.md).
  Core/worker mocks do not replace actual consent or installed-identity results.

No public release, store submission or new version is implied. Hosted checks
remain skipped under #54. Missing manual results are not completed acceptance.
