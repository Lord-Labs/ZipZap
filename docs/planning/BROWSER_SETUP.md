# Browser capture, guided setup and video actions

Prepared 2026-10-23 for [#86](https://github.com/Lord-Labs/ZipZap/issues/86).
[العربية](BROWSER_SETUP.ar.md) · [Roadmap](../ROADMAP.md) ·
[Current phase](NEXT_PHASE.md)

## Outcome and status

Make Windows installation and browser connection understandable, then add scoped
automatic handoff and a **Download with ZipZap** video action where evidence
supports them. Use ZipZap branding, not IDM's logo or copied interface assets.

This is a proposed execution plan, not implemented functionality or an approved
M7 feature release. Source baseline: `e59b281` on main; published app:
`0.2.0-beta.1`. No new browser/runtime/IDM experiment was performed. Source
inspection and official documentation inform the proposals below; actual
Chrome/Edge behavior, store approval and site support remain to be qualified.
No version, completion date, new dependency or performance claim is assigned.

Execution checkpoint, 2026-10-23: #87/#91 and setup code #92/#93 are merged on main
but not published. Complete setup platform acceptance stays in #88/#89; see the
[evidence record](../development/BROWSER_SETUP_QUALIFICATION.md).
[ADR 0011](../architecture/0011-public-link-capture.md) / #94 records the first
scoped capture go decision: opt-in public direct anchor links before browser
transfer, with metadata-only prepare then explicit activation. This replaces
the downloads-API candidate for that slice; global interception remains no-go.
Full #48 and media/YouTube #51 are not closed by this checkpoint.

Capture checkpoint: native #97/#99 is merged; extension #98 implements opt-in
exact-site public file clicks, with actual isolated Chrome/Edge output and
worker/app restart evidence in the [protocol record](../development/CAPTURE_PROTOCOL.md).
Its fixture pregrants page permission; the OS consent prompt and ordinary
installer/platform qualification remain explicit gaps. This does not approve
blanket interception or media extraction.

Media checkpoint: #101 / [ADR 0012](../architecture/0012-public-video-action.md)
records a narrow public direct-player/YouTube progressive-MP4 go, requiring a
separate implementation #103 after decision merge. Its
[verification record](../development/VIDEO_ACTION.md) covers the explicit player
action, bundled tools and current limitations. A private feasibility probe
resolved public format 18 and downloaded combined audio/video through the
existing Manager; it is not a shipped button or arbitrary-site support. Bundled
Python/Node/pure yt-dlp avoid user-side runtime setup, with explicit notices,
process lifetime/output bounds and measured packaging cost. No HLS/DASH/mux/DRM
or cookie scope is accepted, and complete #51/#46/#89 acceptance stays separate.

The remaining M6 work [#46](https://github.com/Lord-Labs/ZipZap/issues/46),
[#47](https://github.com/Lord-Labs/ZipZap/issues/47) and
[#82](https://github.com/Lord-Labs/ZipZap/issues/82) stays open. Setup/readiness
preparation and M7 studies may proceed independently; a new public candidate
needs the qualification gate below. A narrow beta exception is not a waiver
for subsequent releases.

## Source observations

This table records the original `e59b281` baseline before the implementation
checkpoints above; it is not a description of today's main tree.

| Path                                                                                                                                                         | Observed behavior                                                                                                                | Consequence for this request                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [Manifest](../../extensions/browser/manifest.json), [background](../../extensions/browser/src/background.ts), [popup](../../extensions/browser/src/popup.ts) | MV3, contextMenus/nativeMessaging only; explicit link action or pasted URL; no page scripts or download listener                 | Automatic handoff and a player button need separate permissions and implementation decisions.                             |
| [Shared handoff](../../extensions/browser/src/shared.ts), [ADR 0006](../architecture/0006-browser-results.md)                                                | Stable request UUID; receipt, then queued/rejected polling for up to 15 seconds; a timed-out request may still queue             | Receipt is not ownership transfer or completion. Never cancel the browser merely because a request was received.          |
| [Native host](../../crates/zipzap-native/src/lib.rs)                                                                                                         | Exact extension origin; bounded inbox/result files; per-user Chrome/Edge registration; no health action                          | Reuse this boundary, with a narrow compatible health change in #87.                                                       |
| [Desktop shell](../../apps/desktop/src-tauri/src/app.rs), [Svelte UI](../../apps/desktop/src/App.svelte)                                                     | Registration attempted at startup; settings mark connected when registration succeeds; browser enqueue enters the shared Manager | Registration does not prove an extension is installed/enabled in a particular profile. Queued jobs may start immediately. |
| [Installer hooks](../../apps/desktop/src-tauri/installer/hooks.nsh), [Tauri config](../../apps/desktop/src-tauri/tauri.conf.json)                            | Existing per-user NSIS installer, English/Arabic, post-install native registration; failure only prints recovery guidance        | Improve existing installer feedback and first-run guidance, not the installer technology.                                 |
| [Core](../../crates/zipzap-core/src/lib.rs), [user guide](../USER_GUIDE.md)                                                                                  | One Rust Manager, SQLite, validated HTTP(S), safe publication and categories; no stream assembly                                 | Preserve one queue and its integrity. Media detection and media assembly are different work.                              |
| [Browser UI tests](../../tests/ui/browser.spec.ts), [installed browser script](../../scripts/test-browser.mjs)                                               | Mocked protocol/UI coverage plus an installed Chromium/Edge harness; #82 records a stalled runner without an established cause   | Add bounded diagnostics and real Chrome/Edge evidence; do not infer installed success from mocks or Chromium alone.       |

These are source observations, not a new installer usability study. Existing
bounded [IDM research](../research/idm-desktop.md) does not establish its capture
or media internals. Ordinary source analysis needs no new REA investigation;
use [the research protocol](../research/README.md) if a specific artifact question
later requires one.

## Product boundaries and decisions

| Requested behavior      | First proposed scope                                                                                          | Gate / remaining unknown                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Automatic capture       | Opt-in Chrome/Edge handoff for qualified direct public HTTP(S) downloads; explicit mode remains usable        | #48 must prove ownership, eligibility, optional permissions and recovery. No global interception by default.       |
| Easy setup              | Existing NSIS plus three-step, resumable first-run flow and truthful browser status                           | #87 readiness protocol, then #88 setup; store route decided in #50.                                                |
| Video button            | Accessible ZipZap action for supported direct media on permission-granted pages                               | #51 must scope discovery/UI permissions together with #48; a player element or `.mp4` suffix alone proves nothing. |
| HLS/DASH                | Separately scoped unprotected format, if justified                                                            | #51 format/assembly/cancellation/license decision; no stream work hidden in the button PR.                         |
| YouTube                 | Explicit site feasibility and distribution decision, including owned/permitted test videos                    | #51 must answer what is technically and distributably supportable; no arbitrary-video promise.                     |
| Authenticated downloads | Leave browser-owned when the native request cannot reproduce the resource                                     | #49 separately owns headers, credentials, cookies, redirects and storage. No implicit cookie export.               |
| Extension distribution  | Chrome/Edge installation and stable native identities; honest unpacked fallback until approved listings exist | #50 owns accounts/review/IDs; Firefox remains a separate compatibility decision.                                   |

## Execution order and GitHub tracking

| Gate | Issue / slice                                                                                                                                                                                       | Dependencies                                          | Deliverable and completion evidence                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | [#48](https://github.com/Lord-Labs/ZipZap/issues/48), [#50](https://github.com/Lord-Labs/ZipZap/issues/50), [#51](https://github.com/Lord-Labs/ZipZap/issues/51); #49 only for auth-dependent scope | Existing prerequisites in each issue; #51 retains #46 | Separate capture, distribution, direct-video, stream and YouTube go/no-go records with exact browser versions and bounded fixtures. No feature code. |
| P1   | [#87 readiness](https://github.com/Lord-Labs/ZipZap/issues/87) — M                                                                                                                                  | #86 planning PR merged; #43 merged                    | Compatible, bounded health/status evidence; no job, window launch or transfer on a health request.                                                   |
| P2   | [#88 setup](https://github.com/Lord-Labs/ZipZap/issues/88) — L                                                                                                                                      | #87; #50 for store route                              | Installer feedback, first-run flow, EN/AR accessible recovery and explicitly requested first-download verification.                                  |
| P3   | Automatic capture implementation — L, **issue only after #48 go**                                                                                                                                   | #48, #87; installed evidence needs #82                | Small PRs: opt-in/eligibility controls, approved ownership protocol, then restart/fallback qualification.                                            |
| P4   | Direct-video action — M/L, **issue only after #51 scoped go**                                                                                                                                       | #51 and permission/discovery decision with #48; #87   | Bounded discovery, accessible player action and shared direct-file handoff; tested unsupported states.                                               |
| P5   | Stream or YouTube slice — L/unknown, **issue only after its own go**                                                                                                                                | #51; #49/#50 only when required                       | Approve one format/site, dependency and maintenance boundary at a time. A direct-video result cannot close this gate.                                |
| P6   | [#89 qualification](https://github.com/Lord-Labs/ZipZap/issues/89) — L                                                                                                                              | #87/#88, approved implementation issues, #46/#47/#82  | One reviewed candidate, real Windows/browser/output integrity and installer/recovery evidence; separate publication instruction.                     |

M/L are relative change sizes, not time estimates. New #87–#89 stay Todo until
work starts; blocked tasks remain Todo with their blockers. The planning issue
#86 closes only when its documentation PR is merged. #48–#51 remain M7 studies:
record a reviewed scoped decision and create/link implementation issues before
coding their features. A no-go is a valid outcome with a clear user-facing limit.

## Installer and first-run experience

Keep NSIS responsible for installation, prerequisites, language and per-user
registration. Make failure/retry guidance visible and localized. Do not put
browser permissions or a second downloader into NSIS. Qualify WebView2 absent,
offline install, registration failure, repair and upgrade paths explicitly.

First launch proposes this short flow, using current Svelte tokens and controls:

1. **Basics:** language and the system Downloads folder, with an optional native
   folder picker. Keep existing category rules and advanced limits in Settings.
2. **Browser:** choose Chrome or Edge, open the verified store listing when
   available, explain installation, then check connection from that profile.
   Until listings exist, show the documented unpacked path as a temporary
   developer-oriented fallback; do not call it one-click installation.
3. **Verify and finish:** show actual readiness and offer a separate first-download
   test. User-triggered testing uses a reviewed HTTPS fixture, known SHA-256,
   chosen destination and no-clobber filename. Explain the request and cleanup;
   no test file is fetched automatically on startup.

Every step supports Back, retry, skip browser connection and reopening from
Settings. Skipping leaves manual mode ready. Persist progress only after a
successful save; upgrading must not reset settings or loop users through setup.
Validate destinations with current core/native rules and retain prior offline
folders for recovery. No hidden autostart, tray choice or altered security settings.

Readiness must distinguish **host registered**, **host reachable**, **recent
extension contact**, **app available**, and **test file verified**. Display mode
separately: explicit / automatic enabled / automatic unavailable. A desktop app
cannot infer every browser profile's extension state from its registry entry.
Expired or absent evidence is unknown; a host-only ping cannot prove database
readiness. #87 records the minimum protocol, freshness, trust and profile/session
identity policy before implementation, without tracking accounts or browsing.

Use visible labels, inline actionable errors, announced progress, sensible focus
after Back/error, full keyboard operation, Arabic RTL and readable 200% zoom at
the minimum window. Skip is a real action; color alone never communicates readiness.
The existing design system is sufficient; no component library is proposed.

## Automatic capture: ownership before convenience

Candidate API: `chrome.downloads` observation plus pause/resume/cancel, with
optional permission requested when the user enables capture. This is a proposal
for #48 to test, not proof of a lossless interception API. The documented
`onCreated` event occurs after a download begins. Some browser bytes or a tiny
completed file may precede extension action; do not promise zero browser traffic.

Start with fixed, understandable eligibility and opt-out controls: direct
HTTP(S), a bounded file-type/site selection, disable globally or for a site and
return to explicit mode. Exclude unknown eligibility, `blob:`, `data:`, POST/body,
session-dependent, protected or already-complete requests. A URL/MIME/extension
alone cannot establish a public replayable GET; #48 must either establish a
conservative boundary or narrow/no-go the proposal. Private mode is unsupported
initially. Measure signed/one-use links and metadata probes before accepting them.

The current v2 enqueue starts a real job and its timeout can mean queued later.
It is **not sufficient** to guarantee safe automatic ownership transfer.
Compare the smallest compatible staged acceptance/activation change against a
narrower browser-owned, user-confirmed handoff. Record an ADR if the shared
protocol/job boundary changes. Do not add a daemon or generic transaction layer.

The approved design must demonstrate these invariants:

- Browser keeps ownership until eligibility, pause result and native readiness
  are known. Pause/cancel can fail or race completion; recheck actual state.
- Receipt is never permission to discard browser work. Establish durable native
  acceptance and confirmed browser state before activation under the chosen
  protocol; global queue hold/schedule still applies.
- Lost/late acknowledgments are reconciled with the same stable operation ID.
  Timeout never blindly resumes the browser while a native job can still start.
  If outcome is ambiguous, expose bounded recovery with a clear next action.
- Worker/app/browser restarts, extension disable/revoke and version mismatch
  preserve enough bounded state to recover. Define retention/expiry and prevent
  replay/fallback loops; current result/history retention is not infinite.
- Failure returns browser ownership only once native activation is ruled out or
  cancelled. No silent orphaned pause, deleted history or deleted user file.
- Automatic handling must not repeatedly steal window focus. Record the minimum
  launch/focus intent needed while preserving existing explicit-action behavior.

Reject automatic mode for unsupported cases and retain explicit actions if these
invariants cannot be shown. Do not market capture from a happy-path demo alone.

## Video action and YouTube

The button is ZipZap's own **Download video** action near a supported player,
with keyboard/screen-reader access, hide-for-site and popup fallback. Show a
verified candidate and only known filename/type/quality/size; unknown values stay
unknown. It must not cover player controls, intercept playback, multiply after
SPA navigation or advertise a downloadable source that was not found.

Prefer bounded DOM discovery of supported HTTP(S) media under an explicit page
gesture first. `activeTab` is temporary access, not permission for an always-on
button on every site. Persistent per-site buttons require reviewed optional host
access; #48/#51 must record this distinction before choosing permissions.
Content-script isolation is not a trust boundary against malicious page data:
validate messages, sender/frame/origin and URLs again before native handoff.
Never treat a page title, `blob:` player URL or filename as a usable media source.

Test multiple players, SPA changes, fullscreen, nested/cross-origin frames,
source changes/expiry and revoked access. Bound scanning/listeners and detach on
navigation. Denied/restricted pages retain an understandable popup fallback.
Direct files reuse the Manager; HLS playlists and separate DASH audio/video are
unsupported until the approved assembly slice exists. Do not enqueue a manifest
as a successfully downloaded video.

For YouTube, #51 must produce a specific result, not leave the user's request
implicit: permitted fixtures, source availability, signatures/expiry, separate
audio/video, authentication, supported versions and update cost. Compare a
bounded independently maintained path with an external extractor such as yt-dlp;
evaluate FFmpeg only if the chosen format needs muxing. These are candidates,
not selected dependencies. Assess binaries, licenses/notices, distribution size,
update integrity, cancellation/partial cleanup and compatibility with one queue.
No shell-built commands, unreviewed auto-updates or general scraper framework.

The site/distribution decision must review the official YouTube terms, any API
policy actually relied on, and extension-store requirements. Do not assume the
YouTube Data API provides a download URL or that direct MP4 success establishes
site support. State go, narrower scope or no-go with reasons and revisit criteria.
DRM bypass and protected-session extraction remain outside the recorded scope.

## Verification, release and rollback

| Area            | Required meaningful scenarios                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Readiness/setup | No-job health check, missing/old host, stale/profile mismatch, refused permission, failed save, skip/reopen, offline destination, EN/AR/RTL keyboard/zoom and real first-file digest.                                                            |
| Capture         | Fast/tiny/completed downloads, unpausable download, cancel race, late acknowledgment, duplicate event, worker/app/browser crash, permission revocation, auth/POST/one-use URL exclusion, queue held/scheduled and no duplicate completed output. |
| Video           | Supported direct fixtures with hashes; malformed/expired sources, blob/DRM/auth/unsupported stream behavior, multiple players/SPA/fullscreen/frames, controls/focus and bounded cleanup. Site/stream qualification is separate.                  |
| Distribution    | Exact native identity/protocol compatibility, Chrome and Edge actual installed profiles, #82 bounded close diagnostics, fresh install and beta-to-candidate upgrade/repair/uninstall/reinstall with retained data.                               |

Use isolated test state/profiles and owned/public fixtures, never normal
registrations, private captures or personal browsing history. Record exact
commit/build/browser/OS versions and results; mocks do not qualify installed
behavior. Reuse existing UI/Axe, engine, browser and installer fixtures.

Every change requires `npm run check`. Rust changes additionally require
`cargo fmt --all -- --check`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`,
`cargo test --workspace --locked`, `cargo build --workspace --locked`,
`node experiments/engine-strategy/compare.mjs` and `node scripts/test-engine.mjs`.
Run affected UI/browser/installer/media checks as appropriate. Hosted checks are
skipped under #54 unless separately requested; never report them as passed.

#89 records the reviewed candidate, security/privacy/license review, output
hashes, current M6 gaps and bilingual docs. User guides and the download page
must describe only delivered scope. No store listing, signing purchase or public
release is authorized by this planning task. Disable capture/video without
breaking explicit handoff; preserve jobs/files and document incompatible database
recovery. An older binary is not a database downgrade strategy. Publication
requires a separate explicit instruction under the existing release process.

## Official references checked on 2026-10-23

- [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads): events and pause/resume/cancel behavior; runtime qualification is still needed.
- [Service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): durable recovery must survive worker termination.
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): exact native registration/identity remains distinct from extension installation.
- [Permission declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) and [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting): justify the smallest page access and explain its lifetime.
- [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/policies) and [Edge publication](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension): preparation does not establish approval or a live listing.
- [YouTube terms](https://www.youtube.com/t/terms) and [API developer policies](https://developers.google.com/youtube/terms/developer-policies): inputs to the site/distribution decision, not technical download evidence.
- [yt-dlp project](https://github.com/yt-dlp/yt-dlp) and [FFmpeg licensing](https://www.ffmpeg.org/legal.html): candidate evaluation inputs only; neither tool is selected or bundled.
