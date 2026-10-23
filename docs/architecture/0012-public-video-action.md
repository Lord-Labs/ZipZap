# ADR 0012: An explicit public-video action with bundled metadata extraction

- Date: 2026-10-23.
- Scoped decision: [#101](https://github.com/Lord-Labs/ZipZap/issues/101), under #51.
- Status: accepted on merge; production work requires a separate implementation issue.

## Context and evidence

The maintainer requested completing setup, automatic public-link capture and a
player/YouTube button. Setup #92 and capture #96 are merged, unreleased. This
independent, lazy user action can be evaluated without claiming the outstanding
#46 startup measurements. The full #51 study and #46/#47/#88/#89 release/platform
gates remain open; this scoped child does not complete or waive their prerequisites.

Direct HTTP(S) media already uses Manager. A web page, player, blob URL or suffix
alone does not prove a transferable combined media file. Official
[yt-dlp](https://github.com/yt-dlp/yt-dlp/tree/2026.10.21) and
[EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS) describe separate extraction and
JavaScript-runtime requirements. No YouTube Data API, account or cookie export is
proposed. No IDM internals or new native decompilation were studied.

Private feasibility checks on 2026-10-23 used the public Blender
[Big Buck Bunny film](https://peach.blender.org/about/) at YouTube ID
`YE7VzlLtp-4`, without cookies. Pure yt-dlp **2026.10.21**, embedded CPython
**3.14.9**, and an explicitly selected JS runtime resolved format **18**:
HTTPS MP4, AVC video/AAC audio, 640×360, about 597 seconds. Both QuickJS-ng 0.17.0
and bundled Node 24.22.1 succeeded at metadata extraction; no-JS extraction failed.
The fixed selective JSON output with Node was 1,349 bytes.

The existing shared Manager downloaded **25,333,815 bytes**, publication SHA-256
`14a7856e2c8e2df790b36af80e04acfcb0a22bd727c6b79978e1d7cf499e2a2b`.
A separate container check found MP4 `ftyp`, `moov`, `mdat` and `vide`/`soun`
tracks. This proves one public progressive-file feasibility case, not playback
decoding, arbitrary YouTube/site support, protected access or a shipped button.
Raw signed URLs, metadata, binaries and media stay ignored/private.

## First supported boundary

| Source                                                                 | Decision             | Boundary                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public direct MP4/WebM                                                 | Narrow go            | A loaded top-frame player exposes an HTTP(S) source with the supported file suffix; explicit action, existing bounded metadata and core URL/name/no-clobber validation. No cookies or custom session headers.         |
| Public YouTube watch page                                              | Narrow go            | Canonical `https://www.youtube.com/watch?v=ID`, metadata-only extraction, one combined progressive HTTPS MP4 with both codecs; validate returned ID/format/CDN URL before Manager ownership. Availability may change. |
| Generic blob/MSE player                                                | No-go                | A blob is not a source link; do not offer it as a downloadable file. YouTube's supported page action is separate from its blob player.                                                                                |
| Static/live HLS, DASH, separate video/audio, muxing                    | No-go for this slice | Need manifest/segment/assembly and recovery decisions. Do not bundle FFmpeg or claim these tests ran.                                                                                                                 |
| DRM, protected/authenticated, age/login/paid/session-dependent sources | No-go                | No cookie/token harvest, browser credential forwarding or protection bypass. Refusal is an understandable unsupported result.                                                                                         |

No playlists, generic site extractor framework, quality picker without known
formats, automatic helper updater or second downloader/queue is introduced.
Expired signed links follow current core failure/recovery rules; there is no
silent source refresh or claim that a new extraction preserves old partials.

## Page action and ownership

Reuse capture's optional selected-site access and exact-origin policy, with
disclosure of the explicit video action. No page access or media network work is
enabled by default. A ZipZap-branded button appears for supported visible
players on granted normal pages. Bound discovery/observers and visible controls
(at most eight players), handle source/SPA changes, keyboard/screen-reader/RTL,
scroll/resize and fullscreen containers, and provide a popup action when the
native fullscreen video/iframe cannot host a button. Cross-origin frames and
unsupported sources must say why rather than claim discovery.

Per-site off/hide, global disable and permission revocation stop new page actions;
already accepted jobs stay under desktop controls. The background rechecks
extension/frame/document/site/message identity and source eligibility. Canonical
YouTube input is tied to the current watch page. No page-supplied executable,
options, cookies, output path or title is trusted by native code.

Extend ADR 0011's v3 preparation with an explicit `prepare_video` operation and
its own inbox filename. Preserve plain public-link eligibility. A default-false
video marker distinguishes private proposals whose validated direct/CDN links
may include query strings. Preparation has the same 60-second lease and never
creates a job; activation alone uses the existing Manager and UUID. Saved jobs
win before proposal expiry on replay. A cancelled/closed preparation cannot
activate when its late response arrives.

Video failure must not fall back to downloading a YouTube HTML page or a blob.
Show unsupported/refused preparation. Unknown activation remains ambiguous and
uses same-ID status/app recovery, never a second browser copy. Queue ownership
is distinct from completed bytes. Keep URLs out of status/session recovery.

## Bundled tools and process boundary

Choose the official pure zipapp, full embedded CPython and **Node 24.22.1**
executable/full notice. Node is already the development platform and its official
distribution supplies the runtime notice closure and EJS permission mode.
QuickJS's smaller release was feasible, but its Windows build uses MinGW/UCRT
and static mimalloc; avoid adding a separate binary/runtime notice review or a
new source build step in this slice. The Windows PyInstaller yt-dlp executable's
GPLv3+ component closure is not selected. The pure archive includes EJS 0.8.0,
meriyah 6.1.4 (ISC) and astring 1.9.0 (MIT), whose notices must accompany it.

| Input                           |      Bytes | SHA-256                                                            |
| ------------------------------- | ---------: | ------------------------------------------------------------------ |
| CPython 3.14.9 embedded x64 ZIP | 12,609,248 | `3c01d7cfc666f746a6f064f60fb2156ab0ec464d3d738ab796371a46a9bb24a2` |
| Node v24.22.1 Windows x64 ZIP   | 37,748,064 | `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5` |
| yt-dlp 2026.10.21 pure zipapp   |  3,074,818 | `b7af77f686e95f7845ce8d09d21957718febb8b48b30555adb9dd2292ad7bf14` |

Hashes were checked against the official
[Python release](https://www.python.org/downloads/release/python-3149/),
[Node sums](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt) and
[yt-dlp release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21).
Keep CPython unmodified with its full PSF/third-party/Windows distributable-code
conditions, Node's full license, and yt-dlp/EJS/ISC/MIT notices. Include required
distribution terms in the installer's license acceptance. Exact combined archive
inputs cost about 53.4 MB, and selected expanded runtime files about 121.4 MB;
measure the resulting installer rather than claim a predicted size.

Everything is packaged at build time with pinned/hash-verified assets. The user
needs no Python/Node installation, helper download or first-run media network
request. Execute only on the explicit video action; use absolute resource paths,
isolated Python, fixed CLI options, disabled config/plugins/cache/remote
components, explicit bundled Node, no playlist/download execution and bounded
selective JSON. Clear runtime injection environment variables; keep raw stderr
and signed URLs out of user errors. Node permission mode is defense in depth,
not an OS sandbox claim.

Use a Windows kill-on-close job for the whole helper process tree. A fixed small
Python bootstrap waits for a parent start byte before loading extraction code;
assign it to the job before releasing that barrier. This avoids an external JS
child escaping before assignment. Reuse locked windows-sys 0.61.2 for the needed
Win32 structures/APIs. Bound execution/output and kill/wait on cancellation,
deadline, shutdown and malformed output; parent death closes the job. Browser
input can select only a validated public source, never a command or tool path.

## Acceptance before implementation completion

Require meaningful child-tree/timeout/output/missing-tool tests, preparation
expiry/no-job/replay/cancellation cases, owned direct-player fixtures and an
actual public YouTube watch-page action through Chrome/Edge, native and Manager.
Verify bytes/container tracks, permissions/revocation, SPA/multiple players,
fullscreen/popup fallback and EN/AR accessibility. Record source/tool versions
and exact output evidence without publishing signed URLs.

Review installation resources/notices, measure an actual unsigned installer and
keep ordinary setup/absent-WebView/offline/consent/cold-boot gaps explicit in #89.
The [YouTube terms](https://www.youtube.com/static?template=terms) restrict reuse
and downloading; the application cannot infer a user's authorization from public
visibility. User guidance must limit use to sources the site and rights holder
allow saving. This is neither YouTube approval nor a browser-store policy pass;
#50's store decision remains open. No public release/listing is authorized.

Follow all required local npm/Rust/engine checks for the implementation. Hosted
checks stay skipped under #54. The scoped implementation issue is created only
after this ADR's decision PR is reviewed/merged.
