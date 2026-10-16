# Verification

## What runs today

`npm run check` runs Prettier, checks local Markdown file targets, and exercises
the link checker's behavior, and Svelte/TypeScript diagnostics. GitHub Actions runs the same command on Ubuntu and
Windows with Node 24. The same platform jobs now install pinned Rust 1.99.0,
check Rust formatting/clippy, run the unit tests, build the feasibility probe,
and run its six local HTTP scenarios. The final `Repository checks` job aggregates
both results and is the status required for merging. The production core also
has unit validation tests and `scripts/test-engine.mjs`: trusted/untrusted TLS,
byte integrity, safe fallback, durable recovery, cancellation, and queue limits.

Local-link checking verifies inline-link target files, not reference-style links,
Markdown heading anchors, external HTTP availability, or content correctness. It
ignores fenced code examples and external URLs. Those limits are intentional;
reviewers must assess the meaning and accuracy of documentation.

The workspace includes the core, native bridge and Windows desktop shell. CI
builds the frontend and extension, and runs Playwright/Axe on Ubuntu. Windows
prepares the native sidecar before compiling the desktop. aria2 is historical
evidence, not a CI dependency. The core fixture never changes OS trust.

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
