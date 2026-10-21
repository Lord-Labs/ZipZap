# Product scope

## Purpose

Help Windows users download files reliably, recover from interruptions, and send
links from their browser to a local desktop application. The beta is useful for direct file downloads without requiring an account or service.

## First-beta requirements

| Capability       | Acceptance outcome                                                             |
| ---------------- | ------------------------------------------------------------------------------ |
| Direct downloads | Valid HTTP/HTTPS URLs produce complete files with verified bytes               |
| Segmentation     | Parallel ranges only when validated; unsupported servers use a safe fallback   |
| Resume           | Restarts reuse only validated state for the same representation                |
| Queue            | Bounded concurrency, durable order, pause/resume/cancel, and bandwidth control |
| Desktop          | Clear progress, file selection, recoverable errors, and completed-file actions |
| Languages        | English/LTR and Arabic/RTL, readable paths, and keyboard access                |
| Browser          | Explicit link handoff from Chrome/Edge via a validated native bridge           |
| Distribution     | Tested Windows installer, checksum manifest, limitations, and release notes    |

Credentials and authenticated URLs must not leak through logs, crash reports, or
public issues. There is no telemetry or remote account system in the MVP scope.
This is product scope; the qualification record defines the actual verification boundary.

## Current daily-use beta

The [M6 plan](planning/NEXT_PHASE.md) accepts post-beta work on persistence and
storage failure recovery, safe upgrades/publication, actionable retries, safe
filename suggestions and link refresh, one durable queue with scheduling,
batch/category/desktop workflows, explicit tray behavior, browser enqueue
feedback, Windows provenance, diagnostics and release qualification. These capabilities are shipped in 0.2.0-beta.1. See the
[release notes](releases/0.2.0-beta.1.md) and
[qualification record](development/DAILY_USE_QUALIFICATION.md). The quantitative
cold-start gap in #46 and native/browser qualification in #47/#82 remain open;
publication does not complete the full M6 gate.

Scheduling is in-process only while the app is running, including explicit tray
mode. The plan does not introduce a daemon, OS wake/shutdown or several queues.
Automatic browser capture, authentication/proxies, Firefox/store packaging and
media extraction have separate M7 go/no-go studies; no study implies feature
acceptance or broad production permissions.

## Outside the current beta

- Automatic interception of all browser downloads and session-cookie forwarding.
- Video/audio extraction, HLS/DASH processing, and platform-specific extractors.
- OS wake/shutdown scheduling, site crawling, torrents, FTP, and cloud synchronization.
- macOS, Linux, mobile, plugins, and a public automation API.
- Automatic application updates until artifact verification and signing are tested.

Direct media-file URLs can use the ordinary HTTP engine; that does not imply
support for arbitrary web players or protected streams. Firefox follows after
the first Chrome/Edge integration is proven and its separate feasibility gate
is accepted. Time-based scheduling is included within the in-process limits above.

## Quality priorities

1. Correct output and safe recovery before maximum throughput.
2. Bounded memory, connections, retries, and disk activity.
3. Clear state and actionable errors before cosmetic customization.
4. Reproducible performance evidence before marketing claims.

Windows 11 x64 is the initial test target. A broader support promise requires
actual CI and installation evidence. Windows 10 and ARM remain unverified; the beta targets Windows 11 x64, local
NTFS and WebView2.
