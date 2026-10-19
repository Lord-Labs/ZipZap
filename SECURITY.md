# Security policy

## Supported versions

The supported release is [0.1.0-beta.1](https://github.com/Lord-shaban/ZipZap/releases/tag/v0.1.0-beta.1)
for Windows 11 x64. Only the latest beta and current `main` receive security fixes; older prereleases
must be upgraded. Development builds and unsupported operating systems have no
support promise. Install updates manually from the repository's GitHub Releases,
verify SHA-256 and read release notes; no automatic updater is included.

The beta is unsigned. The project claims no Authenticode publisher identity or
SmartScreen reputation. The [review](docs/development/SECURITY_REVIEW.md) records
scope, dependency results and limits, including local plaintext URL history.

## Report a vulnerability privately

Use GitHub's [Report a vulnerability](https://github.com/Lord-shaban/ZipZap/security/advisories/new)
form. Private vulnerability reporting is enabled for this repository.

Include the affected commit/version, reproduction steps, expected and observed
behavior, and a minimal sanitized example. Remove live credentials, private
download URLs, cookies, and personal files. Do not open a public issue or publish
an exploit before coordinating disclosure with the maintainer.

The project is maintained on a best-effort basis; no response-time guarantee is
offered. Maintainers will validate the report, coordinate a fix and disclosure,
and credit the reporter with their consent.

## Security requirements for implementation

- Validate URLs, destination paths, filenames, redirects, IPC, and extension data
  at trust boundaries. Do not execute downloaded content automatically.
- Use normal TLS certificate verification. Do not ship insecure bypasses.
- Treat authenticated URLs and browser session data as secrets. Redact logs;
  do not export cookies silently or commit network captures.
- Preserve partial-file integrity and avoid replacing unrelated destination files.
- Restrict Tauri permissions and native messaging to the capabilities required.
- Keep CI credentials least-privileged. Never run untrusted PR code with release
  secrets or a privileged `pull_request_target` workflow.
- Review dependency licenses and security advisories before distributing builds.
