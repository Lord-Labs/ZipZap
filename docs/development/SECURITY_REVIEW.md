# First-beta security review

This dated review is retained for the first beta. The
[0.2.0-beta.1 review and qualification record](DAILY_USE_QUALIFICATION.md)
adds current dependency results, schema/provenance/diagnostics boundaries,
unsigned distribution and release evidence; it does not claim an independent audit.

Review scope: production core, desktop commands/capabilities/CSP, native host,
extension, temporary files, installer hooks, locks and dependency manifests.
The review is a source/fixture review, not an independent penetration test.

Unreleased extension changes #97/#98 add activeTab/storage plus optional
scripting and selected-site host access. The
[capture protocol/evidence](CAPTURE_PROTOCOL.md) records exact-origin policy,
top-frame sender checks, staged ownership, private bounded metadata and failure
recovery. The original beta review below describes its earlier explicit-only
permissions. No cookies/history/downloads permission, page-provided native
commands or general shell execution is added. The OS consent prompt and store
review are not qualified by the pregranted browser fixture.

## Boundaries and data

- All entry points share HTTP/HTTPS validation. Embedded credentials and unsafe
  redirects (including HTTPS downgrades) are rejected; normal TLS verification
  stays enabled. Errors omit private URL queries. The GUI shows hostnames.
- Filenames reject traversal, separators, controls and Windows reserved names, including superscript COM/LPT device aliases.
  Existing destinations are not overwritten. Partial files use UUID ownership,
  prefix hashes and durable checkpoints; symlink/non-file partials are rejected.
- The SQLite database is per-user and process-locked. It stores private URLs in
  plaintext under the user's normal Windows permissions; this is local state,
  not an encrypted secret store. No credentials or private captures are committed.
- The desktop has local commands only, no arbitrary execution/path-open command
  from JavaScript, and no frontend filesystem/network/shell plugin permission.
  Opening a downloaded file requires an explicit user action on a completed job.
- Native frames are bounded; unexpected origin/schema/version/URLs are rejected.
  UUID requests are fsynced and published by rename; replay is idempotent. Inbox
  and queue quotas bound work. The bridge has no network listener. A local process
  running as the same Windows user can access that user's inbox/database; it is
  not a security boundary against a compromised account.
- The extension asks only for contextMenus/nativeMessaging. It reads no cookies,
  tabs/history or page scripts. Host errors stay visible; acceptance is not a
  successful-download guarantee.
- Development protocol v2 separates receipt from app enqueue/rejection with
  stable UUIDs and allowlisted error codes. Status polling cannot enqueue work or
  launch the app. Results contain no links, filenames or raw errors; retention is
  capped at 100/24 hours. Pending inbox requests survive result-write failure and
  shutdown; saved job UUIDs prevent duplicate enqueue on replay. Compatibility
  with v1 is receipt-only. Real Chrome/Edge qualification remains pending (#43).
- CI tests run with read-only repository permissions and no release secrets.
  The publishing job alone can write releases and uses the protected `beta`
  environment restricted to protected branches. There is no automatic updater.

## Development Windows provenance (#44)

[ADR 0007](../architecture/0007-windows-provenance.md) selects a minimal
`Zone.Identifier` stream with Internet zone 3 before hard-link publication and
verified recovery. Existing Internet/Restricted markers are preserved. No
HostUrl/ReferrerUrl/private query is written, no payload byte changes, no automatic
open, scanner invocation, warning bypass or Windows security setting change.
Unsupported/failed metadata is a persisted advisory warning, separate from valid
completed payload. Explicit Open checks current metadata and asks for native
confirmation if it cannot verify the marker; reveal does not execute the file.
Legacy completed files are not silently relabeled. This does not certify malware
safety or guarantee SmartScreen behavior. The published first beta is unchanged.

## Dependency checks (2026-10-16)

`npm audit --json`: 0 vulnerabilities. `cargo-audit 0.22.2`: 0 vulnerability
advisories, database commit `f28da8c5d386e507fac79153655184056a20c054`.
The full lockfile also reports `proc-macro-error` unmaintained
(RUSTSEC-2024-0370) and glib iterator unsoundness (RUSTSEC-2024-0429).
`cargo tree --target x86_64-pc-windows-msvc -i <package>` confirms neither is in
the Windows dependency graph. They belong to unsupported platform resolution;
no blanket audit suppression is added. Reassess them before other OS support.

`scripts/licenses.mjs` collects the Windows Cargo closure and installed npm
notices, failing when license metadata/text is missing. A few upstream packages
omit notices from their tarballs; repository copies and provenance are under
`licenses/third-party/`. The five unmodified MPL package source archives accompany
the installer/release. Build-only dependencies are explicitly marked as included
in the notice collection; they are not all runtime dependencies.

## Tested failure paths and limits

Development issue #45 adds an explicit support preview/export. Its schema is an
allowlist of app/platform versions (including numeric Windows build), aggregate
counts and typed codes/flags. It never serializes job identities, URLs, paths,
settings or raw errors and performs no automatic upload. Export uses the exact
cached preview and a native-selected new filename, with atomic no-clobber
persistence. Adversarial private strings and 1000-job output bounds have automated
coverage. The maintainer reported native save/cancel/existing-file acceptance on
2026-10-20; this is separate from agent-observed tests and release qualification.

Fixtures cover unsafe input, origin/frame/schema failures, invalid TLS, truncated
responses, output races, damaged partial files, changed resources, forced process
termination, shared limits and an unavailable destination followed by repair.
An unavailable folder is a deterministic I/O failure, not physical disk exhaustion.
Actual power loss and a completely full disk have not been simulated. NTFS hard
links and up to 2x temporary disk space are required. The final-link/SQLite commit
crash interval is described in [engine limits](ENGINE.md).

The beta is unsigned and claims no Authenticode identity or SmartScreen
reputation. Installer tests must not bypass OS/browser security warnings.
