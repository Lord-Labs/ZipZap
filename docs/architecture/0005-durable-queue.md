# ADR 0005: Persist one queue's hold state and dispatch order

- Status: accepted for [#37](https://github.com/Lord-shaban/ZipZap/issues/37).
- Date: 2026-10-19.

## Decision

Use the existing Manager, jobs and scheduler. Schema 3 adds one SQLite `queue`
row with a run/hold flag, separate from editable settings, and a `queue_order`
integer in each job. A stale settings form cannot restart a held queue. Earlier
binaries must reject schema 3 rather than ignore hold/order and start work.

Upgrade schemas 0/1/2 in the existing startup transaction: assign legacy rowid
order, start with the legacy running behavior, validate state and commit all
recovery/queue rows with the schema marker before exposing workers. Reopens sort
the existing job vector by unique positions; malformed/missing queue state or
invalid order fails without resetting the database. Preserve IDs, paths, parts,
publication evidence and individual job states.

Hold prevents new dispatch while active jobs finish. Browser additions wait
while held. Start enables dispatch without unpausing individual jobs. Add for
later creates an ordinary Paused job; Resume makes it wait for queue dispatch.
Resumed jobs keep their existing priority. Existing global/per-host limits and
worker-exit guards apply while running or held.

Move up/down swaps only adjacent waiting jobs' positions in one transaction;
apply live order after commit. Active workers and individually paused/finished
jobs keep their positions. New jobs append with checked arithmetic; gaps need
no compaction. Waiting IDs and run/hold are exposed through snapshots. Keyboard
move controls use this order, independently of visual table sorting. Host limits
can defer an earlier job while a later job on another host is eligible.

## Limits

One queue only. No daemon, named queues, new status, scheduling fields or new
dependency. Older apps need a coherent pre-upgrade backup with all instances
closed; never lower the schema marker. Local checks cover hold/reorder failures,
restart, migration and shared dispatch; release qualification remains #47.
