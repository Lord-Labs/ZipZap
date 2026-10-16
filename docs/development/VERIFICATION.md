# Verification

## What runs today

`npm run check` runs Prettier, checks local Markdown file targets, and exercises
the link checker's behavior. GitHub Actions runs the same command on Ubuntu and
Windows with Node 24. The final `Repository checks` job aggregates both results
and is the status required for merging.

Local-link checking verifies inline-link target files, not reference-style links,
Markdown heading anchors, external HTTP availability, or content correctness. It
ignores fenced code examples and external URLs. Those limits are intentional;
reviewers must assess the meaning and accuracy of documentation.

The current workflow does **not** build a Rust application or test a downloader.
Add actual component checks with the first source for that component; do not add
green no-op jobs named as application tests.

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

Introduce Rust formatting, clippy, unit/integration tests, dependency checks, and
the lockfile with the engine. Include Windows CI for filesystem behavior; add
other platforms only when their checks run and ownership is clear.

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
