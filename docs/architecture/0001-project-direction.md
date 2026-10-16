# ADR 0001: Windows-first, local download manager

- Status: accepted project direction; engine strategy resolved by [ADR 0002](0002-download-engine-strategy.md).
- Date: 2026-10-16.
- Scope: boundaries and technology direction, not a claim of implemented behavior.

## Context

ZipZap needs a reliable download engine, a usable desktop interface, persistent
recovery, and browser handoff. It should remain approachable for an open-source
project without a hosted backend or a large framework for hypothetical features.

## Decision

Target Windows 11 x64 first. Use Rust for the engine/native integration, Tauri 2
for the application shell, Svelte/TypeScript/Vite for UI, and SQLite for local
state. A TypeScript Manifest V3 extension will send explicit link requests through
native messaging. Pin exact toolchains and dependency versions when components
are introduced, not by adding unused manifests now.

Before production implementation, issue #2 compared Rust/Tokio/reqwest with reuse
of aria2. [ADR 0002](0002-download-engine-strategy.md) records the evidence and
selects Rust/Tokio/reqwest. No pluggable-engine layer was introduced.

## Component ownership

| Component             | Owns                                                                      | Must not own                                                 |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Download core         | Transfer state, ranges, retries, queue, persistence, final-file integrity | UI state or browser-specific permissions                     |
| Desktop shell         | Validated commands, dialogs, OS integration, event delivery               | A second implementation of download logic                    |
| UI                    | Presentation, input, accessibility, translations                          | Direct filesystem access or unvalidated native commands      |
| Native messaging host | Framing, extension identity checks, validated handoff to running app      | Arbitrary command execution or a separate download queue     |
| Browser extension     | Explicit user action and minimal metadata                                 | Silent cookie export or unrestricted filesystem destinations |

All entry points converge on the same engine validation and queue. The core
streams bytes to temporary storage; SQLite records recoverable metadata rather
than downloaded file contents. Publish the destination file only after complete,
validated transfer. Checkpoints must correspond to bytes safely written on disk.

## Intended data flow

```text
Desktop URL input -> validated Tauri command -----------------+
                                                             |
Browser action -> native host -> validated desktop handoff ---+
                                                             v
                                                 one queue / engine
                                                   |           |
                                               HTTP(S)      SQLite state
                                                   |
                                            partial file -> final file
                                                   |
                                          progress / result -> UI
```

The exact local IPC mechanism between native host and application is an open
decision for #9. Avoid opening an unauthenticated localhost service as a shortcut.
Use bounded progress updates so a fast transfer does not flood UI IPC.

## Planned source layout

Create these paths only as their implementation begins:

```text
crates/zipzap-core/      engine and persistence
apps/desktop/           Svelte frontend and Tauri shell
crates/zipzap-native/    browser native messaging adapter, if a separate binary is needed
extensions/browser/     shared Chrome/Edge extension
```

Keep the repository-level `docs/`, `scripts/`, and `.github/` for documentation,
small development tools, and automation. Do not create empty crates or an
application-shaped demo as part of planning.

## Alternatives and consequences

- Electron could support the UI, but Tauri's system WebView avoids shipping a
  separate browser engine. Actual memory and startup costs still require measurement.
- A fully native Rust UI would reduce the web toolchain, but this project chooses
  web UI tooling for the intended desktop experience and contribution workflow.
- An existing engine may reduce implementation work; a custom Rust engine offers
  direct control. [ADR 0002](0002-download-engine-strategy.md) resolves the tradeoff
  with a bounded comparison.
- A single application owns jobs for now. Closing the window may keep a tray
  instance alive when that behavior is implemented; a separate service/daemon is
  not part of the MVP. Quitting the process pauses work and preserves recovery state.
- Browser restrictions and site authentication limit what can be handed off.
  Explicit direct-link downloads are the initial contract.

## Verification and sources

See [verification](../development/VERIFICATION.md) for required engine and
integration evidence. No IDM binaries or runtime were inspected for this ADR.

- [Tauri architecture](https://v2.tauri.app/concept/architecture/)
- [Tokio](https://tokio.rs/)
- [reqwest](https://docs.rs/reqwest/latest/reqwest/)
- [HTTP range request semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
