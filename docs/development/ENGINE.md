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
that save fails, the final file, owned assembly and saved publication evidence
remain; the job reports failure. Reopening or retrying can validate and reconcile
that output as described below.

## Saved-state upgrades (development version)

Startup accepts schemas 0/1/2 and upgrades to schema 2 for the optional publication
evidence in [ADR 0004](../architecture/0004-publication-recovery.md).
[ADR 0003](../architecture/0003-atomic-state-upgrades.md) defines the atomic upgrade
contract. Table creation, job validation/recovery
and the schema marker commit in one SQLite transaction before any worker starts.
A rejected update, malformed record or interrupted transaction leaves the prior
committed records recoverable. Job IDs must match their table keys and checkpoint
byte counts must not overflow. Settings use the same value validation as new
settings; an offline saved download folder remains available to repair.

Queue insertion order, validators, checkpoint hashes, settings and owned file
paths are retained. Completed user files are never changed; publication recovery
cleans owned temporary data only after a successful commit.
The migration fixture uses synthetic first-beta JSON, including omitted optional
folder data. Tests cover failed upgrades and retry, table-creation rollback,
reopen, malformed records, and a child process killed with an uncommitted
transaction in rollback-journal and WAL modes. The HTTP fixture resumes an owned
first-beta prefix with its validator, verifies the final digest and reopens it.

## Interrupted publication (development version)

Before creating the final hard link, the shared core commits the assembled file's
length, SHA-256 and filesystem identity. It retains the UUID-owned assembly
(`.part4`) until Completed is durable. On reopening, an unfinished publication is
marked Completed only when the retained assembly has the saved full digest and
identity, and the destination is the same filesystem object. A byte-identical
replacement is a conflict, as are modified/truncated files, unsafe paths and
missing/replaced evidence. Conflicts keep existing output and recoverable parts
and report Failed with `Published file conflict`; no file is overwritten.

If the destination was not yet created, reopening keeps the job resumable. Retry
validates and publishes the retained assembly without another HTTP transfer.
After successful reconciliation, temporary cleanup runs only after the whole
startup transaction commits. Repeated reopening also retries interrupted cleanup,
guarded by the assembly's recorded identity, while retaining completed user files.
Windows validation handles block writes/deletion until the completion save ends.
Full-file digest verification uses bounded memory and can add recovery time for
large files. Older binaries reject schema 2; do not lower its schema marker.

Core tests kill child processes at test-only points immediately before linking,
after linking/before saving Completed, and after saving/before cleanup. They cover
damaged/replaced output and evidence, rejected saves, repair/retry, repeated reopen
and cancellation. HTTP tests verify recovery without another request and a
byte-identical replacement conflict followed by repair. These are process-crash
tests, not physical power-loss simulation. First-beta publications have no saved
proof and still require manual verification if they crashed in this interval.

A newer schema is rejected before changing journal mode or records. Do not edit
`user_version` to force a downgrade. Use the compatible newer binary, or restore a
coherent pre-upgrade SQLite backup with all ZipZap instances closed. Never copy a
live database/WAL pair separately. No additional snapshot is needed for this
transactional upgrade. Keep databases private and preserve completed files;
installer upgrade/downgrade qualification remains part of #47.

## Retry policy (development version)

The shared worker classifies transient network failures, HTTP 408/500/502/503/504
and rate limiting separately from permanent HTTP/authentication, TLS, input,
integrity, storage and publication conflicts. There are at most three attempts.
One safe single-stream fallback after rejected ranges counts toward that bound;
certificate, bounds and representation validation stay enabled.

HTTP 429/503 may supply Retry-After seconds or an HTTP date. Valid delays are
capped at 30 seconds; past dates use zero, malformed values use the normal
500 ms then 1 second backoff. Excessive digit values are capped without integer
overflow. Errors never copy raw Retry-After values or complete private URLs.
TLS source errors are recognized through the existing native-tls backend;
HTTP dates use httpdate rather than a handwritten parser. Both dependencies
are pinned and their MIT/Apache-2.0 notices are collected during packaging.

Jobs expose serde-defaulted `attempt`, `next_retry` (Unix milliseconds) and
`failure_reason` through the existing CLI/desktop snapshot. Details show localized
actionable reasons, the attempt and retry time. Pause/cancel/shutdown interrupt
waits and clear the deadline. Reopening pauses active work and clears old retry
deadlines; explicit resume starts a new bounded attempt sequence. These display
fields are compatible with schema 2 and do not create a durable retry scheduler.
A missing destination is rejected before changing its saved transfer plan; an
inaccessible prefix is retained for repair instead of being discarded.

## Storage failures (development version)

File-operation errors distinguish insufficient space/quota, read-only/access
failure, missing destinations and other storage problems. They stop automatic
retries and retain the last saved segment hashes/counts and owned parts. Repair
the destination and retry explicitly. Bytes after the saved checkpoint are
validated/truncated by the existing resume path; assembly errors keep complete
segments available for reuse. A storage repair does not authorize replacing an
existing output file.

The add dialog explains that size is initially unknown. Selected download details
show an unknown estimate or a conservative peak of twice the known total, with
NTFS guidance in English and Arabic. This is not a free-space reservation or a
promise of capacity; it does not query the URL again. Other jobs/files may consume
space while a transfer runs.

`storage_tests` uses a bounded 3 MiB local HTTP fixture with test-only per-Manager
write, flush and assembly faults. It verifies no automatic retry, retained durable
prefixes after reopen, validated range reuse and exact final bytes after repair.
The HTTP integration fixture separately removes/restores an isolated destination.
UI tests verify localized errors, known/unknown estimates and accessible dialogs.

On the 2026-10-18 Windows verification host, the process token is not elevated and
`New-VHD` is unavailable. An isolated NTFS volume full-disk check and actual
read-only-volume behavior were **not exercised**, not passed. Injected StorageFull
and ReadOnlyFilesystem errors are deterministic behavior coverage, not physical
storage evidence. Release qualification must record these limits and, on a host
that supports it, repeat using a small disposable NTFS VHD with its state database
outside that volume. Fill only that bounded volume, repair its capacity, then
verify retained checkpoints, output SHA-256 and no-clobber behavior. Never fill
the system disk or change a personal drive's permissions for this check.

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
checkpoint are discarded on recovery. Interrupted publication is reconciled only
with the schema-2 evidence above; legacy output without that proof needs manual
verification. The existing file is never replaced. Completed user files are never deleted by queue
history removal. History removal commits the database deletion before removing
the live entry or cleaning temporary parts; a database error keeps them available
for retry. Database URLs may contain private query parameters; keep the
per-user database private and do not attach it to bug reports.
