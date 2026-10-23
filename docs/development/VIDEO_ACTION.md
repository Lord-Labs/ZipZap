# Public-video action qualification

Implementation #103 follows [ADR 0012](../architecture/0012-public-video-action.md)
and the merged setup/capture path. It is unreleased Windows x64 work, separate
from full #51, #46/#47/#82 and platform/setup #88/#89 qualification.

## Boundaries and reproduction

`prepare_video` validates a direct MP4/WebM or canonical public YouTube watch
source and saves an inert 60-second proposal. Only `activate` creates a Manager
job. Default-false proposal fields preserve query-free file capture. Separate
inbox phases, bounded receipts and same-ID replay preserve held queues and avoid
duplicate transfers when an acknowledgment is lost. Cancellation interrupts
metadata/extraction and prevents activation of late results. Video failure never
downloads HTML/blob or starts a browser copy.

The top-frame action requires selected-site permission; no media request occurs
at app startup or setup. At most eight visible supported players have buttons.
YouTube uses its canonical watch page and one player action. Popup fallback,
source/SPA changes, scroll/resize/fullscreen, EN/AR/RTL and hide/off/revocation
reuse the extension's existing site controls. Cross-origin frames, authenticated
sources, live/HLS/DASH, playlists, separate tracks/muxing and DRM are unsupported.

Build tools with `node scripts/build-native.mjs`, then run the required local
npm/Rust/engine checks. `node scripts/test-capture.mjs` tests the worker boundary;
`npx playwright test` covers content/popup/UI and accessibility.
`node scripts/test-capture-browser.mjs --video` uses isolated installed Chrome
and Edge profiles, a unique native-host name and a hidden debug app/Manager.
It pregrants only test-site permissions; it does not qualify browser consent UI.
Raw profiles, signed URLs, outputs and screenshots remain ignored locally.

The media bootstrap waits for a start byte until Windows assigns the Python
process to a kill-on-close job. Fixed absolute tools, isolated Python, cleared
environment, private temp, disabled config/plugins/cache/remote components,
35-second execution and 32-KiB output limits bound metadata extraction. Node's
permission mode is defense in depth, not an OS sandbox claim. Helper errors are
sanitized. Media bytes always use the existing engine.

## Local results

On 2026-10-23, Windows 11 build 26200, Node 24.19.0:

- `npm run check`, Rust fmt/clippy (warnings denied), all 90 workspace tests and
  workspace build passed. Six engine probe scenarios and all 48 engine scenarios
  passed. The optional aria2 comparison was not run.
- All 68 Playwright UI/Axe tests passed, including nine video tests with keyboard
  Enter, displaced YouTube video and scroll visibility coverage. EN/AR screenshots
  were visually inspected. Worker tests cover source/page binding, site hide/off,
  permission revocation, cancelled late preparation and recovery privacy.
- Process tests cover the real Windows job API with a barrier/child fixture:
  bounded output, failure, missing resources, deadline, cancellation and abrupt
  parent death stop descendants. Metadata rejects wrong IDs/CDNs/protocols,
  missing audio, live and DRM flags; cancelled proposals never create jobs.

The actual Chrome 155.0.8059.86 and Edge 155.0.4283.62 path, with WebView2
155.0.4283.62, passed direct-player and public YouTube action through native and
Manager. The owned generated WebM output matched its fixture digest; native
video fullscreen hid the button and popup recovery confirmed the same request
without a second job. Real file capture, held queue, lost acknowledgment,
worker/app restart, destination refusal/browser fallback exactly once, v2
explicit handoff and site off also passed.

Both browsers downloaded Blender's public `YE7VzlLtp-4` MP4 with **25,333,815
bytes**, SHA-256
`14a7856e2c8e2df790b36af80e04acfcb0a22bd727c6b79978e1d7cf499e2a2b`.
An independent HTTP fetch matched; container parsing confirmed `ftyp`, `moov`,
`mdat` and `vide`/`soun` tracks. This is container/byte integrity evidence, not a
codec playback audit or arbitrary YouTube availability claim.

The rebuilt unsigned NSIS installer was extracted and compared byte-for-byte
against the build output: all 46 media resources, 13 extension files, five source
archives and the collected license file matched. The installer license includes
the full CPython/Windows redistribution terms. Its size is **41,211,200 bytes**,
SHA-256 `0e4327ae784beac0ea0633cd63da3222e254f0927f6af500049b24fff84fddf5`.
This verifies package contents, not an installed production-browser identity.

Earlier harness attempts were unsuccessful: one used stale native output,
another did not observe a watch-page button within its deadline, and the actual
bootstrap exposed an incorrect module entry point and format filter. The final
bootstrap runs the pure archive's top-level zipapp and accepts a non-DRM combined
format; those unsuccessful attempts are not passes. A concurrent engine test
also held a binary during compilation; the required workspace checks were rerun
successfully in sequence. Private artifacts remain outside Git.

A later Edge run reproduced a missing badge while the player thumbnail remained
visible. Isolated DOM diagnostics found the video positioned at `top: -495px`
inside the visible 880×495 player. The action now anchors to that video's
YouTube player container on a canonical watch page; direct players retain their
own bounds. A mocked watch-page regression reproduces the displaced video and
checks its explicit canonical-source activation. The harness foregrounds the
page and scrolls the player into view before asserting a visible button.

## Remaining qualification

These profiles pregrant test permissions and use a unique test host/debug app.
They do not qualify the browser consent prompt, production installed identity,
offline/absent-WebView2 install, interactive installer-language acceptance or
cold-boot/painted-readiness. #88/#89/#46/#47/#82 remain open; the original #82
stall's root cause is not established by this run. No normal user registration
was replaced. Full #51, authentication #49 and stores/Firefox #50 remain separate.
All hosted workflows are skipped under #54. No public release or extension-store
submission occurred.
