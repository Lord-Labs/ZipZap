# ADR 0002: Own the download state in a small Rust core

- Status: accepted direction for production work starting in issue #3.
- Date: 2026-10-16.
- Issue: [#2](https://github.com/Lord-shaban/ZipZap/issues/2).
- Evidence: [bounded comparison](../research/engine-strategy.md) and its reproducible fixture.

## Decision

Use Rust with Tokio and reqwest for the production core. Keep transfer state,
representation validators, segment checkpoints, and the future SQLite queue in
one core owned by ZipZap. Do not bundle aria2, add an RPC service, or introduce
a swappable-engine abstraction for the first beta.

The experiment pins Rust 1.99.0, Tokio 1.53.3, and reqwest 0.13.5 with default
features disabled and `native-tls` enabled. This uses the Windows TLS backend on
Windows and system OpenSSL on Linux, without adding a separate crypto-provider
build. TLS verification remains enabled; the loopback experiment itself uses
HTTP and does not establish HTTPS correctness. Revisit TLS backend selection if
the actual platform trust requirements justify a change in issue #3.

The experimental binary is not the production core. Its fixed fixture identity,
8 MiB total buffering, and blocking writes must not become the production design.
Issue #3 starts with streaming, safe file handling, and a small explicit API.

## Why this choice

| Consideration              | Rust/Tokio/reqwest                                                         | aria2 sidecar                                                                         |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Existing functionality     | HTTP client/runtime available; transfer state must be built                | Segmentation, pause/resume, queues, and RPC already available                         |
| Integration                | Direct typed calls and progress from the same application process          | Binary packaging, process ownership, protocol/error mapping, and lifecycle management |
| Recovery ownership         | One planned state store with explicit resource validators                  | `.aria2` state plus application metadata and validator policy must be coordinated     |
| Tested behavior            | Exact ranges, stable resume, changed-resource rejection, body cancellation | Segmentation, ignored-range completion, stable seeded resume, process cancellation    |
| Changed seeded-prefix case | Rejected before appending                                                  | Mixed representation in the specific no-sidecar continuation test                     |
| Testability                | Loopback fixture plus direct core state tests                              | Loopback fixture plus external process/RPC and packaging tests                        |
| Direct license metadata    | Tokio MIT; reqwest MIT OR Apache-2.0                                       | aria2 GPL-2.0-or-later; redistribution review needed if bundled                       |

aria2 is a viable reuse option, not a rejected tool for lack of features. A
wrapper could check validators before handing work to aria2, and a secure
supervised sidecar could avoid an exposed RPC endpoint. That still leaves two
state/lifecycle boundaries to coordinate. For this project's bounded HTTP-first
scope, explicit integrity requirements, and chosen Rust integration, a small
owned core is the more coherent direction despite more initial engine work.

Licensing is a distribution consideration, not a claim that a sidecar cannot be
used with an MIT application. Any such combination requires its own review.

## Evidence and limits

The local 8 MiB comparison confirms feasibility, not product completeness or
performance superiority. It has no production queue, persistent checkpoints,
crash recovery, user cancellation control, HTTPS fixture, or benchmark. The
aria2 continuation test seeds a contiguous file without a `.aria2` control file;
it does not establish how every aria2 resume mode behaves.

Automatic CI repeats Rust formatting, linting, unit tests, and six fixture
scenarios on Windows and Ubuntu. The recorded external binary comparison is
local Windows evidence; CI does not silently install or claim to test aria2.

## Consequences and next steps

- Issue #3 implements a single streamed transfer, temporary-file ownership,
  bounded memory, safe destination handling, cancellation, and meaningful errors.
- Issue #4 probes real range responses, validates bounds/identity, and adds a safe
  single-stream fallback. The experiment intentionally rejects ignored ranges.
- Issue #5 owns crash-safe checkpointing and resume validation; a file's length
  alone never proves it belongs to the same remote representation.
- The future UI and extension call the same queue/core; they do not implement a
  second downloader or depend on this experiment's CLI.
- Revisit the decision if direct-engine maintenance exceeds its justified scope
  or a maintained engine satisfies the state contract with substantially less work.

## Sources

- [reqwest 0.13.5](https://docs.rs/reqwest/0.13.5/reqwest/)
- [Tokio 1.53.3](https://docs.rs/tokio/1.53.3/tokio/)
- [aria2 1.37.0 manual](https://aria2.github.io/manual/en/html/aria2c.html)
- [aria2 release and license metadata](https://github.com/aria2/aria2/tree/release-1.37.0)
- [HTTP If-Range semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-range)
- [Direct dependency notices](../../THIRD_PARTY_NOTICES.md)
