# ADR 0008: Schedule the existing queue gate in local civil time

- Status: accepted implementation policy for [#42](https://github.com/Lord-shaban/ZipZap/issues/42).
- Date: 2026-10-20.

One optional window belongs to the existing Manager: a local date (one shot) or
selected Monday–Sunday weekdays, and start/hold times with minute precision.
Weekdays name the start date; an earlier hold time belongs to the following day.
Equal times are invalid. Scheduled hold has the existing queue semantics: active
transfers finish, new starts wait, and individual pauses remain untouched.

Follow the operating system's local zone. Resolve a repeated DST time at its
first occurrence. Skip a window whose start falls in a DST gap; a hold in a gap
moves forward by the gap. A detected zone change holds the queue and skips past
starts. Jiff refreshes the system zone on a five-minute cache, so detection can
lag a system change by up to five minutes. A backward wall-clock change cannot replay an already consumed event.
After a forward jump or sleep longer than 90 seconds, skip missed starts and
apply any due hold. Normal ticks allow at most 90 seconds of start lateness.

Enabling/editing a schedule holds new dispatch until a future start. Restart
also holds it and skips missed/current starts; it never catches up automatically.
Manual Start/Hold consumes events through that instant and wins over duplicate
ticks. The next future boundary can act again. A local start date is consumed at
most once, including across DST folds, zone changes and restart. Disabling the
schedule preserves the current gate; users can then Start explicitly.

Schema 5 adds one bounded schedule record. Gate and consumed-event cursor commit
in one transaction, before live state changes. Failed saves block new dispatch
and expose a recoverable error until saving succeeds or the user disables the
schedule. Opening/migration validates everything and commits recovery, schedule
and schema together; older binaries reject schema 5.

Use already locked Jiff 0.2.38 (Unlicense OR MIT) directly for civil dates and
system/IANA zone transitions. Standard Rust has no local-zone/DST conversion;
handwritten Windows/calendar rules would be larger and less safe. Jiff is already
in the desktop dependency closure; reuse its pinned packages and notice collector.
Do not add a scheduler library, service, OS wake timer or additional queue.

Inject timestamps and zones into core tests before adding UI. Actual Windows
sleep/resume observation remains distinct from those tests and is required for
qualification. Scheduling works only while the app runs, including explicit tray
mode; it does not wake the computer or start the app.
