# Public-link capture protocol implementation

Native slice [#97](https://github.com/Lord-Labs/ZipZap/issues/97) implements
[ADR 0011](../architecture/0011-public-link-capture.md) under #96. This is
unreleased protocol infrastructure. Extension slice
[#98](https://github.com/Lord-Labs/ZipZap/issues/98) adds the opt-in/click UI;
the checks below distinguish its actual browser evidence from mock boundaries.

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

## Extension slice #98: actual and simulated evidence

Run `npm run build:extension`, `node scripts/test-capture.mjs` and
`npx playwright test` for worker-boundary and content/popup checks. These cover
default-off permission requests, declined consent, sender/frame/private/origin
rejection, exact-origin choices, revocation, 100-record/24-hour recovery,
activation ambiguity, app versus host refusal, no URL lists in session recovery,
trusted click eligibility, browser fallback without recursion, late preparation
after content timeout, late activation acknowledgment, same-ID status and EN/AR
accessibility. The simulated timer/transport cases are not native-browser passes.

`node scripts/test-capture-browser.mjs` builds a unique hidden debug app, uses a
private state junction/profiles and a uniquely named test host, and asserts the
ordinary Chrome/Edge registration is unchanged. Its test extension copy
pregrants scripting/loopback access and delays one real activation acknowledgment;
production code has no fault-injection switch. The OS permission consent prompt
is not exercised by this fixture. It preserves private artifacts rather than
deleting downloads/state.

On 2026-10-23, installed Chrome **155.0.8059.86** and Edge **155.0.4283.62**, with
WebView2 **155.0.4283.62**, both passed:

- Real trusted page click → v3 prepare/activate → actual desktop Manager.
- Held queue accepts one job without browser/output transfer; delayed activation
  acknowledgment shows unknown ownership without a browser copy.
- Capture preserves the fixture window's hidden state; the legacy explicit
  handoff may raise it as intended. Each browser starts a fresh hidden app process.
- Actual extension worker termination and desktop quit/reopen, then same-ID
  status confirmation; one saved job remains.
- Starting the shared queue publishes the exact 1,048,576-byte fixture,
  SHA-256 `d12d0182a4797ab1c11f5c225073ab9d5a4d8061bbbd595e23dc6e0b4a69319e`.
- Occupied destination returns once to the browser without another engine job or
  replacing the existing file; explicit v2 popup handoff also matches the digest.
- Turning the site off leaves its next click with the browser and adds no job.

Initial fixture runs corrected a loopback permission pattern and the assertion's
serialized status case; those aborted runs are not acceptance passes.
The window check also exposed fixture setup/quit races: explicit v2 legitimately
raises the previous process, and quit can close WebView before its IPC promise
settles. The runner now starts a fresh hidden process and requires clean process
exit; production permissions and test timeouts were not relaxed. Logical
proposal expiry/quota/storage refusal are exercised by the native/worker tests,
not claimed as separate full-browser scenarios. No ordinary installer, absent
WebView2, browser consent prompt, store, YouTube or cold-boot qualification is
implied. #88/#89/#46/#47 and the original #82 evidence gaps remain separate.
