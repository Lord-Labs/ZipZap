# Engine strategy probe

An isolated feasibility experiment for [issue #2](https://github.com/Lord-shaban/ZipZap/issues/2).
This is not a production downloader or a reusable engine abstraction.

The small Rust binary accepts only IPv4 loopback HTTP URLs with an explicit port.
The Node harness serves deterministic 8 MiB fixtures on a randomly assigned
loopback port and compares complete SHA-256 digests, exact requests, and observed
connection closure. Requests have time limits; generated files live in a unique
temporary directory that is checked before cleanup.

## Run

Install the pinned Rust toolchain through rustup and Node 24. On Windows Rust's
MSVC target needs the C++ Build Tools and Windows SDK. The probe's `native-tls`
backend uses Windows TLS there and system OpenSSL development libraries on Linux
(provided by the current Ubuntu GitHub runner).

```sh
cargo build --workspace --locked
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
node experiments/engine-strategy/compare.mjs
```

To include the external-engine comparison, obtain aria2 from its official
[release page](https://github.com/aria2/aria2/releases/tag/release-1.37.0), record
the downloaded artifact's identity, and pass its absolute executable path:

```sh
node experiments/engine-strategy/compare.mjs /absolute/path/to/aria2c
```

PowerShell accepts a quoted Windows path as the last argument. aria2 is optional
for this historical comparison; it is not installed by the harness, bundled in
ZipZap, or required by CI. CI explicitly runs only the Rust scenarios. Local
aria2 evidence is retained separately with its version and acquisition details.

## Scenarios and limits

- Rust: two concurrent exact ranges, rejection of ignored or malformed ranges,
  stable-validator resume from a seeded prefix, changed-validator rejection with
  the prefix untouched, and aborting a response body after receiving some bytes.
- aria2 when provided: segmented transfer, ignored-range behavior, `--continue`
  from a seeded contiguous prefix with unchanged/changed resources, and process
  cancellation observed at the server.
- The seeded aria2 prefix has no `.aria2` sidecar. This tests that specific
  continuation mode, not every aria2 resume configuration. The harness observes
  the outcome of a changed resource rather than presuming safe detection.
- Rust buffers at most 8 MiB total for this fixture and performs blocking writes.
  Production code must stream with bounded buffers and safe file finalization.
- No HTTPS, crash recovery, SQLite, retries, throughput, memory, or real-site
  compatibility claim follows from this experiment. Delays make cancellation
  observable and are not a speed benchmark.

See the [decision](../../docs/architecture/0002-download-engine-strategy.md) and
[recorded results](../../docs/research/engine-strategy.md).
