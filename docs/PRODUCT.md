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

## Deferred

- Automatic interception of all browser downloads and session-cookie forwarding.
- Video/audio extraction, HLS/DASH processing, and platform-specific extractors.
- Time-based scheduling, site crawling, torrents, FTP, and cloud synchronization.
- macOS, Linux, mobile, plugins, and a public automation API.
- Automatic application updates until artifact verification and signing are tested.

Direct media-file URLs can use the ordinary HTTP engine; that does not imply
support for arbitrary web players or protected streams. Firefox follows after
the first Chrome/Edge integration is proven.

## Quality priorities

1. Correct output and safe recovery before maximum throughput.
2. Bounded memory, connections, retries, and disk activity.
3. Clear state and actionable errors before cosmetic customization.
4. Reproducible performance evidence before marketing claims.

Windows 11 x64 is the initial test target. A broader support promise requires
actual CI and installation evidence. Exact minimum supported versions will be
recorded before the first release.
