# Product scope

## Purpose

Help Windows users download files reliably, recover from interruptions, and send
links from their browser to a local desktop application. The first beta should
be useful for direct file downloads without requiring an account or service.

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
This describes a requirement, not an audit of an application that already exists.

## Next-beta scope

The [M6 plan](planning/NEXT_PHASE.md) accepts post-beta work on persistence and
storage failure recovery, safe upgrades/publication, actionable retries, safe
filename suggestions and link refresh, one durable queue with scheduling,
batch/category/desktop workflows, explicit tray behavior, browser enqueue
feedback, Windows provenance, diagnostics and release qualification. These are
acceptance targets, not shipped capabilities. The published beta remains as
described above; application versions change only during a qualified release.

Scheduling is in-process only while the app is running, including explicit tray
mode. The plan does not introduce a daemon, OS wake/shutdown or several queues.
Automatic browser capture, authentication/proxies, Firefox/store packaging and
media extraction have separate M7 go/no-go studies; no study implies feature
acceptance or broad production permissions.

## Outside the published first beta

- Automatic interception of all browser downloads and session-cookie forwarding.
- Video/audio extraction, HLS/DASH processing, and platform-specific extractors.
- Time-based scheduling, site crawling, torrents, FTP, and cloud synchronization.
- macOS, Linux, mobile, plugins, and a public automation API.
- Automatic application updates until artifact verification and signing are tested.

Direct media-file URLs can use the ordinary HTTP engine; that does not imply
support for arbitrary web players or protected streams. Firefox follows after
the first Chrome/Edge integration is proven and its separate feasibility gate
is accepted. Time-based scheduling is now planned in M6, within the limits above.

## Quality priorities

1. Correct output and safe recovery before maximum throughput.
2. Bounded memory, connections, retries, and disk activity.
3. Clear state and actionable errors before cosmetic customization.
4. Reproducible performance evidence before marketing claims.

Windows 11 x64 is the initial test target. A broader support promise requires
actual CI and installation evidence. Exact minimum supported versions will be
recorded before the first release.
