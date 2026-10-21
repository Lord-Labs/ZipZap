# Verification

The [daily-use beta qualification record](DAILY_USE_QUALIFICATION.md) covers
0.2.0-beta.1, including local and hosted results, the explicit publication
decision and the remaining #46 measurement gap. The dated sections below retain
their original source/version boundaries.

## Daily-use beta publication (2026-10-21)

[0.2.0-beta.1](https://github.com/Lord-shaban/ZipZap/releases/tag/v0.2.0-beta.1)
is published from `e1edf759dad1292c1050025bde177fb2439d8718` by
[run 39530014651](https://github.com/Lord-shaban/ZipZap/actions/runs/39530014651).
Core/build and installer upgrade/repair/uninstall/reinstall checks passed.
Seven downloaded assets, all six payload hashes, the browser/source ZIP contents
and the exact tag target were verified. The qualification record contains actual
hashes and the explicitly unsigned status.

Publication used the maintainer's version-specific exception. Installed-browser
automation was skipped in this run; earlier Repository failure/cancellation remain
unchanged. #46, #47, #82 and the full M6 gate stay open. Do not describe this as
complete hosted/native/browser/performance qualification.

## Native current-source baseline (2026-10-18)

[Issue #29 evidence and repeatable procedure](NATIVE_SMOKE.md) cover actual
WebView2/Tauri downloads from source `6568cc9`, with isolated identity/state,
real pause/resume/reopen/cancel, exact output hashes, safe history removal,
native folder selection, OS open/reveal handoff, and English/Arabic keyboard
and accessibility-tree checks at 780×560. Browser/installer evidence remains
separate. Hosted tests were skipped by the current maintainer policy.

## Desktop workspace follow-up (2026-10-17)

[Issue #25](https://github.com/Lord-shaban/ZipZap/issues/25) replaces the desktop
dashboard with a compact toolbar, filename categories and sortable table. Local
`npm run check` passed with zero Svelte errors/warnings; `npm run build:web`
passed. All nine Playwright UI tests passed, including command/error handling,
selection, categories, sorting and English/Arabic layouts. Axe found zero
violations in the tested empty/modal/populated states at 375/780/1200 pixels.
The final Arabic screenshot was visually inspected using synthetic fixture jobs.

These tests mock the Tauri IPC boundary. Native Windows download, browser,
installer and Rust checks were not repeated for this frontend/configuration
change. The existing beta evidence below remains evidence for its original
commit. GitHub Actions is skipped for this change at the maintainer's explicit
request; no hosted-check result is claimed. The
[IDM study](../research/idm-desktop.md) records the reference evidence and limits.

## What runs today

`npm run check` runs Prettier, checks local Markdown file targets, and exercises
the link checker's behavior, and Svelte/TypeScript diagnostics. Required checks
run locally. As of 2026-10-18, [maintainer decision #54](https://github.com/Lord-shaban/ZipZap/issues/54)
disables automatic hosted checks and removes their required merge status, while
preserving PR, conversation-resolution and linear-history protections. Hosted
checks are skipped unless separately requested; this is not a passing result.

The retained manual Repository workflow runs the same command on Ubuntu and
Windows with Node 24. The same platform jobs now install pinned Rust 1.99.0,
check Rust formatting/clippy, run the unit tests, build the feasibility probe,
and run its six local HTTP scenarios. The final `Repository checks` job aggregates
both results; it is no longer required for merging. The production core also
has unit validation tests and `scripts/test-engine.mjs`: trusted/untrusted TLS,
byte integrity, safe fallback, durable recovery, cancellation, and queue limits.

Local-link checking verifies inline-link target files, not reference-style links,
Markdown heading anchors, external HTTP availability, or content correctness. It
ignores fenced code examples and external URLs. Those limits are intentional;
reviewers must assess the meaning and accuracy of documentation.

The workspace includes the core, native bridge and Windows desktop shell. Manual CI
builds the frontend and extension, and runs Playwright/Axe on Ubuntu. Windows
prepares the native sidecar before compiling the desktop. aria2 is historical
evidence, not a CI dependency. The core fixture never changes OS trust.

## Windows retry-clock fixture precision (#70)

On 2026-10-19 one capped-retry fixture assertion failed before its cancellation
checks; surrounding full runs passed. A separate local stdin/stdout probe compared
Rust 1.99.0 `SystemTime::now` with a later Node 24.19.0 `Date.now` reading 5,000
times. Rust's timestamp was 1–3 ms ahead in all samples. No clock setting was
changed. This reproduces a cross-runtime observation mismatch, not excess retry
sleep; the original failed sample did not capture its exact difference.

The pinned [Node/V8 Windows clock](https://github.com/nodejs/node/blob/v24.19.0/deps/v8/src/base/platform/time.cc)
resynchronizes a tick-based clock to `GetSystemTimeAsFileTime`; its source records
approximately 1–15.6 ms system-clock resolution. The pinned
[Rust Windows clock](https://github.com/rust-lang/rust/blob/1.99.0/library/std/src/sys/time/windows.rs)
uses the precise system API. The fixture therefore allows 20 ms of Windows-only
timestamp observation margin and reports deadline/current/remaining values on
failure. Other platforms retain the strict bound. The application's 30-second
retry cap and exact Rust duration test are unchanged; cancellation/shutdown and
payload-integrity checks remain required. This is not a scheduler-clock policy.

## Engine gates (M1–M2)

Use deterministic local HTTP fixtures instead of depending on third-party servers.
Compare the complete output bytes or a cryptographic digest with the fixture.

| Area     | Required cases                                                                      |
| -------- | ----------------------------------------------------------------------------------- |
| HTTP     | Redirects, errors, TLS validation, unknown size, truncation, cancellation           |
| Ranges   | Correct 206/Content-Range, ignored Range/200, 416, overlap/gaps, changed validators |
| Recovery | Process interruption, inconsistent state, missing partial files, changed resource   |
| Files    | Existing destination, unsafe names, no free disk space, interrupted finalization    |
| Queue    | Concurrent transitions, retry bounds, per-host limits, shared bandwidth control     |
| Secrets  | URL/header redaction and absence of credential data in logs                         |

Rust formatting, clippy, a unit test, the fixture harness, and the lockfile exist
for the probe. Expand meaningful unit/integration and dependency security checks
with the production core. Windows/Ubuntu probe CI is tooling evidence, not a
promise that the future desktop app supports Linux.

## Desktop and browser gates (M3–M4)

Verify a complete UI action through native commands, engine, persistence, and final
file on actual Windows WebView2. Test keyboard focus, labels, Arabic RTL, mixed
paths, and empty/loading/error states. Mocked UI tests alone do not prove native
integration. The browser flow must be exercised separately in Chrome and Edge.

Check malformed native messages, length limits, unexpected extension identities,
missing hosts, duplicate handoff, and installer registration cleanup. Test
permission failures without weakening security boundaries to make tests pass.

## Release and performance gates (M5)

Record commit, tool versions, Windows version, hardware, server behavior, network
conditions, file sizes, connection counts, repeated samples, and exact commands.
Measure CPU/memory alongside throughput. Publish raw sanitized measurements and
limitations; do not generalize from a single fast local-server run.

Installer evidence includes clean install, launch, upgrade, uninstall, and retained
downloads. Only actual verified capabilities belong in release notes or README
feature lists. See [release process](RELEASING.md).

## Recorded Windows integration (2026-10-16)

Windows 11 Pro build 26200 x64, WebView2, Node 24.19.0 and Rust 1.99.0.
A real desktop URL/folder action downloaded a 16 MiB local fixture:
`01a12f59399d0486b14577e498d91675c69b35238726f44128ce4d4763544408`.
Native folder selection, English/Arabic switching, persisted folder/language,
completed rows and polite status text were inspected in the Windows accessibility
tree. Keyboard focus/Escape, form validation and layouts at 375/780/1200 pixels
also passed the three UI tests; Axe reported zero violations in those states.
This is not a claim of screen-reader certification.

A per-user NSIS installation exited 0 and registered both browser host keys.
Chrome for Testing 149.0.7827.55 and Microsoft Edge 155.0.4283.45 sent real
popup requests through the installed native host, app and engine. A closed app
started from the host. Both produced 1 MiB files with SHA-256:
`b8a74bb29f5cab9c4aa7e78d78053b0c23ef8cbbaccd8796396659e39eb3623c`.
Invalid file URLs were rejected; a duplicate destination showed a recoverable
app notice and left the original file intact. Tests used isolated profiles.
Edge used the CDP `Extensions.loadUnpacked` test API because branded-browser
command-line sideload flags are restricted; no personal profile or browser policy
was changed. Chrome stable branding/store installation remains untested.

Sources: [Playwright extension testing](https://playwright.dev/docs/chrome-extensions),
[CDP extension test API](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/).

The installed app also paused `manual-restart.bin` at 13.6 MiB, closed, reopened
with the same paused state and Arabic/default-folder settings, then resumed to
the exact original 16 MiB SHA-256 above. The deterministic core suite now also
tests an unavailable destination followed by repair/retry and immediate resume
while the paused worker exits (23 scenarios total).
See [benchmark evidence](../research/benchmark.md) and
[security review](SECURITY_REVIEW.md) for M5 details and untested physical faults.

The release-candidate NSIS installer passed clean installation, same-version
upgrade/reinstall and silent uninstall on this Windows host. Both native host
registry keys and manifest were checked after install, then absent after removal.
The existing SQLite database and a retained download kept their SHA-256 values.
License text and MPL source resources were included in the installed files.
There is no older public ZipZap version to exercise a cross-version upgrade yet;
reinstall tests the installer replacement path, not a future schema migration.
The same `scripts/test-installer.ps1` runs on clean Windows CI runners.

## First-beta acceptance checklist

- [x] HTTP/HTTPS, validated ranges, fallback, redirects and errors produce verified bytes or safe failures.
- [x] Pause/restart/resume, immediate resume, changed resources and damaged partials preserve file integrity.
- [x] Queue order, concurrency and shared bandwidth limits pass deterministic fixtures.
- [x] English/Arabic desktop downloads, persisted settings, keyboard interaction and automated accessibility checks pass.
- [x] Chrome for Testing and Edge handoff reach complete files through the installed host and shared engine.
- [x] Source security review, dependency notices, MPL sources and known limitations are recorded.
- [x] Windows clean install, same-version reinstall and uninstall preserve state/downloads and clean up host registration.
- [x] Protected CI publishes the reviewed commit as a prerelease, and downloaded assets match its checksum manifest.

## Published beta (2026-10-17)

[0.1.0-beta.1](https://github.com/Lord-shaban/ZipZap/releases/tag/v0.1.0-beta.1)
was published from reviewed commit `c9caec970ec244c17319f01afdd1a510716b6b51`.
[PR #18](https://github.com/Lord-shaban/ZipZap/pull/18) records distribution/security
verification; [PR #21](https://github.com/Lord-shaban/ZipZap/pull/21) fixes immediate
resume while a paused worker finishes its checkpoint. The
[protected-main checks](https://github.com/Lord-shaban/ZipZap/actions/runs/38987645035)
passed on Windows and Ubuntu. The
[Windows beta workflow](https://github.com/Lord-shaban/ZipZap/actions/runs/38988700324)
rebuilt that commit, passed the installer lifecycle and published through `beta`.

All seven release assets were downloaded after publication. The six payloads
(installer, browser ZIP, third-party sources ZIP, notices, dependency metadata and
MIT license) matched every entry in `SHA256SUMS.txt`, with no missing or extra
payloads. The published tag was independently checked against the commit above.

- Installer SHA-256: `954ed29c5d9379799725954c2abfd8a80de92c9652d7cb72b3ecf3c7aa582969`.
- Manifest SHA-256: `a84fd729a36330751383b3177e25ce2f87252ebfb4f8ff43a65eb8f9f498e68c`.

The unsigned Windows 11 x64 support scope and all
[release limitations](../releases/0.1.0-beta.1.md) still apply. `npm audit --json`
was repeated on 2026-10-17 and reported zero vulnerabilities.
