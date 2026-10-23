# Public-link capture protocol implementation

Native slice [#97](https://github.com/Lord-Labs/ZipZap/issues/97) implements
[ADR 0011](../architecture/0011-public-link-capture.md) under #96. This is
unreleased protocol infrastructure; the extension opt-in/click UI and complete
Chrome/Edge capture acceptance belong to the next slice.

## Local ownership and recovery

Version 3 uses `prepare` (UUID and query-free HTTP(S) URL), `activate` (UUID only)
and read-only `status`. V1/v2 explicit handoff is preserved. The host stamps each
inbox operation with its creation time; a client cannot supply that timestamp.
Separate `UUID-prepare.json` and `UUID-activate.json` files prevent retirement of
one operation deleting the other. Atomic no-clobber publication binds each
pending operation to its UUID and URL.

Prepare uses the existing bounded metadata suggestion and saves a proposal for
at most 60 seconds from inbox creation, never a job/output. Proposals and inbox
are capped at 100. Activation consumes live validated metadata through Manager;
normal destination, hold and scheduling rules apply. A saved job wins before
expiry/replay checks. A failed result write retains the operation for same-ID
reconciliation. Expired metadata is inert, cleaned while the app runs, and never
touches downloaded files. Results keep the existing 24-hour/100-entry retention.

Only an app-published `app_rejected`, `destination` or `capture_expired` can prove
no job after activation. Host `expired`, quota errors, transport errors, lost
acknowledgments and inability to launch the app remain ambiguous; they cannot
authorize a browser copy. Before activation, any preparation failure may return
to the browser because preparation cannot dispatch. Results contain no URL/path.

Capture launch includes `--browser-background`, preventing repeated single-instance
focus. The host clears inheritance on its own Windows standard handles as well
as passing null child stdio. Null stdio alone still reproduced response-pipe
retention in the regression fixture. This follows Windows
[handle inheritance](https://learn.microsoft.com/en-us/windows/win32/sysinfo/handle-inheritance)
semantics and adds no dependency or service.

## Evidence and remaining acceptance

Local tests exercise metadata-only preparation, held-queue activation, duplicate
activation, missing acknowledgment storage, reopen/replay, expired/future inboxes,
missing proposals, shutdown, schema/action/URL rejection, UUID binding, proposal
quota/expiry, protocol separation and receipt privacy. A GUI-subsystem stub keeps
running after the native host exits: the pipe regression failed before the fix
and passes after it. CLI tests keep missing-app capture ambiguous and preserve
legacy explicit start-failure reporting. The explicit browser harness now scopes
its submit selector to its form after the health button was added.

These are native/unit/CLI checks. They do not complete real browser capture,
worker restart/late acknowledgment, the old cancelled runner #82, full platform
setup #88 or candidate qualification #89/#46/#47. The reproduced inheritance bug
is not claimed as the proven location of #82's original stall. No hosted checks,
store submission or release publication were requested.
