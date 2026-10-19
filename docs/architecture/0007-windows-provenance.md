# ADR 0007: Preserve Internet zone metadata without publishing private URLs

- Status: accepted for issue #44, pending verification of this implementation.
- Date: 2026-10-19.

Before Windows publication, write only `[ZoneTransfer]` / `ZoneId=3` to the
owned assembly's `Zone.Identifier` alternate data stream and flush it. The
existing no-clobber hard link publishes that same file, including its streams.
Recovery applies the same policy to the verified assembly before completing a
recovered publication. Never write a URL, referrer, filename or query into zone
metadata. Treat all HTTP(S) output as Internet-origin, including local fixtures;
never lower an existing Internet or Restricted zone marker.

Use ordinary Windows file streams through the Rust standard library and the
existing no-reparse/share guards. No new dependency or COM lifetime is needed.
Microsoft documents streams as independent data with per-stream sharing modes;
zone information uses NTFS streams. Payload bytes and the existing publication
identity/hash contract remain unchanged.

Attachment Execution Services was considered. `IAttachmentExecute::SetSource`
can expose the supplied URL to UI/handlers, and `Save` can invoke trust services
that delete or alter the file. Integrating those policy/scanner outcomes into
publication would require a separately scoped decision. This bounded change
records Internet origin, without calling execution, scanners, warning bypasses
or changing Windows security settings. It does not certify file safety or
guarantee a SmartScreen prompt.

Zone metadata failure is advisory: preserve validated payload/recovery and
complete with a persisted `unavailable` provenance warning. Windows explicit
Open checks the current marker and requires a native warning confirmation if
the marker is absent/unreadable. Show in folder does not execute the file.
Legacy jobs default to unknown provenance; never claim they were marked.
Non-Windows headless testing does not claim Windows metadata support.

The optional persisted field is compatible with schema 4: older binaries may
ignore the advisory field, while the file's stream is independent. Upgrading
does not rewrite already completed files or store their private URLs in streams.
Unsupported filesystems/permissions are reported as unavailable; the existing
hard-link storage requirement still applies.

## Official references

- [Microsoft file streams and sharing modes](https://learn.microsoft.com/en-us/windows/win32/fileio/file-streams)
- [Attachment Manager zone storage and filesystem limits](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-attachmentmanager)
- [SetSource URL handling](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iattachmentexecute-setsource)
- [Save trust-service and file mutation behavior](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iattachmentexecute-save)
- [Microsoft PowerShell zone mapping](https://devblogs.microsoft.com/powershell/how-does-the-remotesigned-execution-policy-work/)
