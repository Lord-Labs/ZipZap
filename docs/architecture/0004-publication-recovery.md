# ADR 0004: Retain owned publication evidence until completion is durable

- Status: accepted for [#32](https://github.com/Lord-shaban/ZipZap/issues/32).
- Date: 2026-10-18.

## Decision

Advance SQLite to schema 2 in the existing atomic startup transaction. Add one
optional `publication` job field, defaulting to absent for schemas 0/1. Before
creating the no-clobber final hard link, save the assembled file's byte count,
SHA-256 and filesystem identity. Retain its UUID-owned `.part4` hard link until
Completed is committed. An older binary must reject schema 2 instead of ignoring
the evidence or cleaning files needed for recovery.

On reopening an unfinished publication, validate the retained assembly's identity,
length and full digest, then require the destination to be the same filesystem
object. Only then save Completed. A different file is a conflict even if its bytes
match. Missing, damaged, inaccessible or replaced evidence must not authorize
adopting an existing destination. Keep output and evidence available for repair.
If the destination is absent, reopening keeps the job resumable; an explicit
resume validates and publishes the retained assembly without downloading again.

Keep validation handles open through the completion save. On Windows, read-only
sharing blocks concurrent writes/deletion while validating and committing. Reject
symlinks/reparse points. Startup cleans owned temporary paths only after its whole
transaction commits; a failed save retains them. A completed record can retry
cleanup on later opens, guarded by the retained assembly's recorded identity.
Cancellation/removal keep the existing rule that final user files are retained.

Use Windows `FILE_ID_INFO` (volume plus 128-bit file ID), and device/inode on Unix
for the existing core fixtures. Add a direct Windows-only use of the already
locked `windows-sys` 0.61.2 package (MIT OR Apache-2.0), with no new package version
or transitive dependency. Stable Rust lacks the required Windows file-identity
access; hand-written FFI or a helper with weaker identity checks would add risk.
The existing notice collector includes this dependency in release packages.

## Limits and verification

First-beta crashes have no saved publication proof; existing destinations from
those versions still require manual verification. Preserve schema-2 state and use
a compatible app rather than lowering `user_version`. This does not claim a
physical power-loss simulation or support for storage without hard links/file
identity. Whole-file validation adds a bounded-memory read during recovery.

Test-only fault points immediately before linking, after linking/before saving
Completed, and after saving/before cleanup let a parent kill a child process at
the real publication boundaries. They are absent from production builds. Verify
repeated reopen, failed saves and repair/retry, and modified/truncated/replaced
destinations, including byte-identical replacements. HTTP tests cover the same
path through the shared Manager; native installer qualification remains #47.

## References

- [Windows FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)
- [GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)
- [Rust Windows metadata](https://doc.rust-lang.org/stable/std/os/windows/fs/trait.MetadataExt.html)
- [Atomic startup contract](0003-atomic-state-upgrades.md)
