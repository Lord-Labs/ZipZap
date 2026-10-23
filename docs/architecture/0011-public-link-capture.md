# ADR 0011: Capture opted-in public links before browser transfer

- Date: 2026-10-23.
- Decision slice: [#94](https://github.com/Lord-Labs/ZipZap/issues/94), under #48.
- Status: accepted by merging this decision; implementation requires its own issue.

## Evidence and alternatives

The maintainer requested implementation of the browser/setup plan after #90.
Readiness #87 and setup implementation #92 are merged. Preserve the single
Manager, explicit v1/v2 handoff, URL/path validation and normal browser behavior
outside the accepted scope.

The [downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
reports creation after a browser download starts and does not expose its request
method in DownloadItem. In bounded local tests on installed Chrome 155.0.8059.86
and Edge 155.0.4283.62, GET and POST downloads used the same URL and identical
fixture bytes without a method field. Pause/resume and invalid-ID refusal worked;
a trusted anchor handler prevented its browser request during a 250 ms observation
window. Output hashes matched. No native handoff, worker-restart or late-ack
implementation was tested by this probe. Private profiles/artifacts remain ignored.

Reject blanket observation/cancel-after-enqueue: it cannot establish replayability
and current v2 timeout can still mean a late queued job. Adding a new staged core
status would affect schema, every entry point and user actions unnecessarily.
Choose a short-lived metadata preparation at the existing inbox boundary instead.

## Accepted first scope

Capture only an explicitly enabled exact page origin, in a normal top-level
HTTP(S) page, after browser permission consent. Intercept trusted unmodified left
clicks on same-origin, query-free direct file links with a download attribute or
a small documented file-extension set. Skip prevented events, other targets,
modified clicks, credentials, private mode, POST/forms, script-created downloads,
Save As/global interception, blob/data URLs and unknown eligibility. Users enable
only sites whose links are public; protected/session-dependent resources remain
unsupported and cookies are never exported.

Capture is off by default. Keep explicit menu/paste handoff. Provide enable/off
per site, global disable and understandable fallback/recovery. Explain that the
page must remain open until the app confirms the handoff; closing it before
activation can cancel that attempt. This is deliberately narrower than universal
IDM parity. Page-link collection is a separate no-go for this slice; existing
batch input remains available.

Use activeTab for a user-invoked current-page context and local storage for
bounded per-origin choices. Request scripting and only the selected site's host
access optionally. No downloads/history/cookies/webRequest permission is needed.
Dynamic content scripts run only on granted sites; the background validates
sender ID, top frame, actual origin, enabled policy and message schema on every
operation. Revocation prevents new operations; already accepted jobs stay under
the desktop's explicit controls.

## Ownership protocol

Introduce v3 capture operations while preserving v1/v2 explicit handoff:

1. **Prepare:** prevent the original anchor default, validate the candidate,
   and request bounded metadata preparation through the native host. The desktop
   may use its existing bounded metadata probe. Save a private proposal containing
   the UUID, link, safe name/destination and a deadline at most 60 seconds away.
   There is no engine job and no file output. A confirmed proposal returns
   `prepared`; a receipt alone never activates work.
2. **Activate:** only after the page receives `prepared`, request activation with
   that same operation ID. Revalidate expiry, URL/path/destination and current
   shared-core limits, then add once through the Manager. Hold/schedule still
   governs dispatch. A saved job wins on replay before checking old proposal
   expiry or publishing its final result.
3. **Report/recover:** `queued` means the app owns the job, not completion.
   A definitive rejection without a job can return the link to the browser.
   Before activation, failed/unknown preparation may safely fall back because a
   proposal cannot dispatch. After activation is sent, timeout/disconnect must
   query/recover the same ID or direct the user to the app; never blindly start a
   browser copy while a late native job is possible. Status creates no work.

Prepare and activate use separate per-action inbox filenames to avoid deleting
a just-arrived activation while retiring a preparation. Proposal count and inbox
remain bounded (100), reads reject non-files/oversized data, publication is atomic
and stale metadata is removed without touching user output. Results retain the
existing 24-hour/100-result bound and contain only IDs/states/allowlisted codes,
not links or paths. Idempotency is bounded by retained results and job history;
expired/ambiguous activation never implies automatic browser fallback.

A proposal is not a second transfer queue: it cannot run, be resumed or become a
job without explicit activation. No core schema/status, daemon, localhost listener,
generic rule/transaction engine or new dependency is introduced. A background
launch intent prevents repeated single-instance activation from raising the app;
normal explicit handoff keeps its current behavior. Native child stdio must not
retain the browser response pipes.

## Required implementation evidence

The implementation issue must test preparation-only failure/no job, activation
replay, late acknowledgments, app/worker restart, expiry, storage/quota refusal,
occupied destinations, held/scheduled queue, disabled/revoked permissions and
source/sender rejection. Browser fallback must not loop or erase history/files.
Test real Chrome and Edge with isolated state and output hashes; a DOM/API probe
is not an end-to-end capture pass. Keep #82/#46/#47/#89 qualification explicit.
No hosted workflow is authorized; local checks remain mandatory under #54.
