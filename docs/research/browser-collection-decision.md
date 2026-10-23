# Browser capture and page-link collection decision

Date: 2026-10-23. Decision-only parent: [#48](https://github.com/Lord-Labs/ZipZap/issues/48).
Source reviewed: `72d943a56467a1ed740647f60ac0f15f66a33f33`.
The published `0.2.0-beta.1` has explicit handoff; the narrow capture implementation
on main is unreleased. This study adds no production permission or feature.

## Decision

Retain the narrow go already recorded in [ADR 0011](../architecture/0011-public-link-capture.md):
capture a trusted eligible anchor click before its browser request, only on an
explicitly enabled site whose links are public and reusable. Reject general
post-start takeover through the downloads API. **No-go for page-link collection
in the current candidate**, independently of the capture decision. Existing
desktop batch preview remains the available collection workflow.

Collection is technically plausible with a user gesture and temporary access.
Its deferral is a scope decision: no concrete collection use case, bounded
selection UI or collection-specific browser fixture has been qualified. It is
not a finding that browser APIs cannot enumerate links. Any implementation
requires a separately reviewed scope; this report does not authorize it.

## Evidence and limits

| Reference                                                                                                                                                                                                                                                                            | Observation                                                                                                                                                                                                                                                                                                                               | Boundary                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR 0011](../architecture/0011-public-link-capture.md), prior private `capture-probe/dd2ab780-572e-405d-af4d-073a92c8b353/results.json`                                                                                                                                             | Installed Chrome **155.0.8059.86** and Edge **155.0.4283.62** produced the same URL/bytes for GET and POST downloads without a method field; pause/resume and invalid-ID refusal worked. A trusted anchor handler prevented its request during the bounded observation.                                                                   | Prior recorded probe, not rerun here; no native ownership evidence in that early probe.                                                                                                                                            |
| [Capture protocol evidence](../development/CAPTURE_PROTOCOL.md)                                                                                                                                                                                                                      | Those installed browsers and WebView2 **155.0.4283.62** reached a real Manager, held one job, reconciled delayed acknowledgment and worker/app restart, rejected an occupied destination, and left site-off clicks with the browser. Output: 1,048,576 bytes, SHA-256 `d12d0182a4797ab1c11f5c225073ab9d5a4d8061bbbd595e23dc6e0b4a69319e`. | Reused evidence; private test identity, pregranted permissions and debug app. OS consent, production installed identity and full candidate qualification are excluded. Logical expiry/quota/storage cases are native/worker tests. |
| Private `closure-review/capture-media/fixture-results.json` and `probe.mjs`                                                                                                                                                                                                          | Node **24.19.0**, existing headless Manager binary SHA-256 `badf6a15432c3560cc002310d839371bd426cf5aa4003d62cba3f12d50f8c821`: metadata `suggest` requested query-free `/once.zip` with `GET Range: bytes=0-0`, created no job, and the next GET received **410**.                                                                        | Prior owned loopback fixture inspected here, not a new browser/REA result. No real signed site or personal session was accessed.                                                                                                   |
| [Manifest](../../extensions/browser/manifest.json), [policy](../../extensions/browser/src/capture-policy.ts), [worker](../../extensions/browser/src/capture-background.ts), [content](../../extensions/browser/src/content.ts), [native host](../../crates/zipzap-native/src/lib.rs) | Permanent contextMenus/nativeMessaging/activeTab/storage; optional scripting/HTTP(S) host grants; enabled exact-origin policy and top-frame/sender checks; one shared Manager.                                                                                                                                                            | Source inspection, not execution. Browser host match patterns do not distinguish ports; application origin checks narrow the granted host access.                                                                                  |

REA's existing IDM resource inventory establishes no capture behavior and is not
used to infer any. Ordinary source and owned fixture records answer these
questions; no new decompilation, packet capture or benchmark is claimed. Private
profiles, binaries, raw URLs and detailed results remain outside Git.

## Why broader capture is rejected

The [downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
announces an existing download. DownloadItem does not supply the original HTTP
method/body. Tiny downloads can finish before intervention; pause/cancel can
refuse or race. Enqueuing natively and then cancelling the browser cannot prove
unique ownership. Deleting browser history is a separate operation and is not
part of handoff. No universal takeover result is claimed.

A URL suffix, MIME or query-free shape also cannot prove public/reusable GET.
The one-use fixture makes that limit concrete: a metadata probe can consume
access even without retaining the response body. Signed, one-use, authenticated,
session-dependent, POST/body, blob/data and unknown requests remain unsupported.
Enabling a site is the user's assertion about reusable public links, not a
server-level proof. Browser fallback can itself fail after a one-use entitlement
has been consumed. This limits the accepted capture scope.

Keep metadata-only preparation at the existing inbox boundary. It avoids a
second queue, core job-status migration or dependency. Only activation may add
one job. Existing explicit actions stay available; a consciously requested native
copy does not retroactively eliminate bytes already transferred by the browser.

## Ownership, controls and permissions

| State/event                                             | Decision and evidence                                                                                                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before activation; preparation fails or host is absent  | A proposal cannot dispatch. Return to the browser once; retain explicit actions. Native/worker tests cover this boundary.                                                                                                              |
| Activation sent; timeout/disconnect/late acknowledgment | Ownership is unknown until same-ID status or the app resolves it. Never start a browser duplicate automatically. Actual delayed-ack/restart evidence is recorded above.                                                                |
| App/worker restart                                      | Recover the retained UUID; do not invent another operation. A saved job wins on replay. Results/attempts are bounded to 100 and 24 hours; proposals to 100 and at most 60 seconds. Idempotency is bounded by retained results/history. |
| Queue held or scheduled                                 | Activation transfers ownership once; normal Manager controls decide dispatch. Held queue has actual browser evidence; schedule behavior is covered separately by core tests.                                                           |
| Definitive app rejection; destination occupied          | Fallback once only when the app proves no job; host/transport failure after activation does not prove absence. Occupied destination has actual browser evidence.                                                                       |
| Permission revoked, site off or global off              | Stop new operations, preserve already accepted desktop jobs and files. Site-off has actual browser evidence; revocation has worker coverage.                                                                                           |
| Window focus                                            | Capture uses bounded background launch; ordinary explicit handoff may raise the window. Actual hidden-window checks are recorded in the capture evidence.                                                                              |

Default remains off, with per-site enable/off and global disable. A small fixed
extension set or download attribute selects candidates; arbitrary user file-type
rules are not implemented. Same-origin/query-free/top-level trusted unmodified
left-click checks exclude forms, script downloads, other frames, private mode
and other targets. Permissions never justify broader eligibility.

[Optional permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
are requested at runtime for scripting and the selected site. Persistent capture
or player controls need that host grant. A hypothetical one-shot collector can
instead use [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
plus scripting after a gesture; access expires on cross-origin navigation/close.
Neither path needs cookies, history, webRequest or downloads permission.
[Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
requires recoverable persisted state rather than reliance on a live timer.

If collection is revisited, scope one local top-frame `a[href]` snapshot with a
link/byte cap, safe scheme/credential filtering, relative-URL resolution,
deduplication, explicit preview/selection and existing Manager validation. No
crawling, automatic transfer, cross-frame access or network metadata probes.
An owned fixture must distinguish navigational links, duplicates, malformed
URLs and private/one-use resources. These are future acceptance conditions,
not implemented behavior.

## Acceptance disposition

| #48 criterion, including its 2026-10-23 addendum                             | Disposition                                                                                                                               |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Separate capture/collection decisions, exact versions and least permission   | Narrow existing capture go; collection no-go for this candidate; evidence and permission boundaries above.                                |
| Duplicate/cancel/refusal/host failure/restart/recovery fixture               | Reuse selected-path browser/native/worker records with the distinctions above. Broader downloads-API path is rejected, not marked passed. |
| Off/default/allowlist/revert and safe ownership                              | Existing ADR/protocol plus controls/ownership table; no browser history/file deletion.                                                    |
| Go/no-go before implementation                                               | Existing narrow ADR and #96/#97/#98; this broader decision adds no implementation.                                                        |
| Early bytes/tiny files, pause refusal, POST and replay eligibility           | Reject universal downloads-API takeover; prior GET/POST/pause evidence and explicit race limits.                                          |
| Signed/one-use metadata consumption                                          | Query-free one-use consumption observed; real signed sites remain unsupported and untested.                                               |
| Staging, UUID retention, late ack, cancellation, queue/restarts/revoke/focus | Existing accepted protocol/evidence, with native/worker versus actual-browser cases separated.                                            |
| Gesture inspection versus persistent player; independent collection          | Explicitly separated; [media decision](../architecture/0012-public-video-action.md) does not authorize a collector.                       |

This is a completed decision proposal for review, not a new qualification pass.
It can resolve the decision-only issue after review accepts the independent
collection no-go and unsupported-link limits. #82/#88/#89 and #46/#47 retain
their separate production identity, consent, installer and candidate gaps.
Hosted checks were skipped under #54. Primary API pages were checked on
2026-10-23; documentation is not an additional runtime result.
