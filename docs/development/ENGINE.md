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

Resume requests made while a paused worker finishes its durable checkpoint are
queued immediately; the scheduler waits for that worker to exit before restarting.

## Persistence failures (development version)

Pause, resume, cancel, scheduler starts and checkpoints save a candidate before
changing live state or cancelling workers. A rejected action leaves its previous
state, worker token and recoverable parts intact. A replacement transfer plan is
also saved before discarding obsolete parts. These changes are not in the
published first beta.

Database failures stop automatic transfer retries. If the worker cannot save its
terminal state, it releases its queue slot and exposes a live Failed status with
an explicit **last saved state retained** error through the same desktop snapshot
and headless jobs response. That error/status could not be persisted: reopening
recovers the last saved checkpoint, normally as Paused. Repair storage before
retrying; a successful retry commits the new state. Already saved pause, queued
resume and cancel decisions survive worker exit without another redundant save.

Completed is exposed only after its save succeeds. If publication succeeds but
that save fails, the final file and parts remain; the job reports failure. The
existing manual publication-recovery limit below still applies until #32.

## Saved-state upgrades (development version)

Startup accepts first-beta schemas 0/1 and retains schema 1; no speculative M6
fields are added. [ADR 0003](../architecture/0003-atomic-state-upgrades.md)
defines the contract for future fields. Table creation, job validation/recovery
and the schema marker commit in one SQLite transaction before any worker starts.
A rejected update, malformed record or interrupted transaction leaves the prior
committed records recoverable. Job IDs must match their table keys and checkpoint
byte counts must not overflow. Settings use the same value validation as new
settings; an offline saved download folder remains available to repair.

Queue insertion order, validators, checkpoint hashes, settings and owned file
paths are retained; startup never removes or modifies partial/completed files.
The migration fixture uses synthetic first-beta JSON, including omitted optional
folder data. Tests cover failed upgrades and retry, table-creation rollback,
reopen, malformed records, and a child process killed with an uncommitted
transaction in rollback-journal and WAL modes. The HTTP fixture resumes an owned
first-beta prefix with its validator, verifies the final digest and reopens it.

A newer schema is rejected before changing journal mode or records. Do not edit
`user_version` to force a downgrade. Use the compatible newer binary, or restore a
coherent pre-upgrade SQLite backup with all ZipZap instances closed. Never copy a
live database/WAL pair separately. No additional snapshot is needed for this
transactional upgrade. Keep databases private and preserve completed files;
installer upgrade/downgrade qualification remains part of #47.

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
changed resources, fallback, errors, cancellation, and output races. SQLite
triggers inject checkpoint/terminal and completion-save failures during actual
HTTP downloads, followed by repair, retry and reopen checks. Core unit tests also
cover rejected pause/resume/cancel actions, failed scheduler saves and worker-exit
races; the history-removal regression remains required.

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
history removal. History removal commits the database deletion before removing
the live entry or cleaning temporary parts; a database error keeps them available
for retry. Database URLs may contain private query parameters; keep the
per-user database private and do not attach it to bug reports.
