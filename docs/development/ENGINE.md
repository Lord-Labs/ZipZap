# Download core

The production core is `crates/zipzap-core`. It streams HTTP/HTTPS bodies to
UUID-owned temporary files, validates exact range bounds and strong ETags,
checkpoints durable prefixes and their SHA-256 hashes in SQLite, and publishes
only complete output without replacing an existing destination.

The queue supports at most four active jobs, four connections per job, four
active response streams per effective host, bounded retries, cancellation,
pause/resume, and a shared bandwidth limit. Unknown/weak validators, missing or
changed partial data, changed effective URLs, ignored ranges, and invalid range
responses trigger safe restarts or the single-stream fallback.

## Verify

```sh
cargo build --workspace --locked
cargo test --workspace --locked
node scripts/test-engine.mjs
```

The Node fixture generates a one-day self-signed localhost certificate using
OpenSSL (Git for Windows' OpenSSL on Windows). Only the test CLI process is given
that certificate as an explicit trust root; the OS trust store is never changed.
The same fixture verifies rejection without that trust root. Tests cover actual
bytes, checkpoint recovery after a killed process, partial-file corruption,
changed resources, fallback, errors, cancellation, and output races.

## Headless interface

`target/debug/zipzap <state.sqlite> [explicit-ca.pem]` accepts one JSON command
per stdin line and returns one result/error per stdout line. Commands: `add`,
`jobs`, `action`, `settings`, and `shutdown`. This local interface has no network
listener and never executes downloaded files. See the integration fixture for
exact request shapes. The desktop uses the same Rust Manager directly.

## Filesystem and recovery limits

Publication uses an atomic no-clobber hard link. Windows destination storage must
support hard links (normally NTFS); unsupported filesystems fail clearly and keep
recoverable parts. Assembly can require up to twice the download size temporarily.
Files are flushed before their checkpoints are committed; bytes beyond a saved
checkpoint are discarded on recovery. A process terminated in the narrow interval
between publishing the final link and committing the completed state can leave a
correct final file with a failed job on retry; the existing file is never replaced.
Reconcile that file manually. Completed user files are never deleted by queue
history removal. Database URLs may contain private query parameters; keep the
per-user database private and do not attach it to bug reports.
