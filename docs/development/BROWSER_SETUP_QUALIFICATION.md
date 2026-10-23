# Browser and setup implementation evidence

This records unreleased implementation, not a qualified new public release.
Published `0.2.0-beta.1` and its disclosed M6 gaps remain unchanged.

## Readiness — #87 / PR #91

Merged at `a23f88d` after required local checks. The isolated health harness
passed with installed Chrome 155.0.8059.86 and Edge 155.0.4283.62. Both reached
the real native host without creating an inbox or job and correctly distinguished
host-only from a synthetic desktop heartbeat. Normal registrations were not
replaced. Synthetic heartbeat evidence is not an actual desktop/database test.
See [ADR 0010](../architecture/0010-browser-readiness.md).

## Guided setup — #88

Source baseline `a23f88d`; changes are tracked by the linked implementation PR.
The flow saves language/folder through existing validation, includes extension
files in the installer, reports real contact separately from registration, and
offers a user-triggered known-file test. Progress is a local UI preference, not
a database migration. No transfer or browser permission is requested on launch.

Local checks on 2026-10-23:

- `npm run check`: formatting, local links, all five Node tests and Svelte
  diagnostics passed with zero errors/warnings.
- Rust fmt, workspace/all-target clippy with warnings denied, all 74 workspace
  tests and locked workspace build passed. Tests include the copied uninstall
  helper's argument validation and preservation of another installation's manifest.
- Historical comparison: six scenarios passed; no aria2 comparison performed.
  Production engine: all 48 scenarios passed with verified output bytes.
- Extension/frontend builds and the complete 51 UI/Axe tests passed. Four setup
  tests cover failed saves/retry, skip/no automatic test, progress resume,
  cancellation, mismatched publication, verified data, Arabic RTL and keyboard use.

### Native Windows flow

Windows 11 Pro build 26200, WebView2 155.0.4283.62. A hidden current-source debug
build used a separate identifier, state, download directory and WebView profile.
No native sidecar was beside that executable: registration therefore failed
before writing ordinary browser keys, allowing actual recovery UI to be tested.
The CDP driver exercised the real bundled UI and native settings/queue commands,
not mocked IPC.

First-run basics, registration-failure feedback, skip browser, explicit HTTPS
test, publication verification, finish and graceful quit passed. The actual
download was 1,076 bytes with SHA-256
`86c61424f3af99d567c4386400a28c9f47b0e33a6228a59b671c81797b266120`,
matching the pinned public project license. It was written only to the isolated
destination. The first driver attempt failed a path assertion because Rust
returned Windows' canonical extended path; the driver was corrected to compare
namespaced paths, with the earlier isolated state preserved, and subsequent runs
passed. That initial harness assertion failure is not a product pass.

### Installer lifecycle

A separate NSIS debug package with a unique product name/identifier and no
sidecar passed fresh-path installation, same-version repair, uninstall, reinstall
and second uninstall. Bundled extension manifest, Arabic locale and worker were
present. Database/settings and all completed fixture files retained their hashes;
ordinary native-host registry values and manifest hash were unchanged.
The actual package-registration failure path was exercised silently.

A production-identity release package was built but not installed or published:
4,205,143 bytes, SHA-256
`e5d5acdc0ee68fdaae6d9d1c4df2e32f4ff5218559790cbcf677d5ee5acfbb17`,
Authenticode `NotSigned`. This is an intermediate packaging check, not an
immutable release or a claim that every later source-only layout adjustment is
contained in that artifact. Private drivers, profiles, screenshots and builds
remain in ignored local research storage.

## Qualification gaps before maintainer acceptance

The isolated installer omitted the production sidecar deliberately. It does not
qualify ordinary production registration or the complete installed-download path.
The normal bridge was never replaced for testing. WebView2-absent/offline install
and interactive installer-language acceptance were not exercised. The existing
native registration/ownership checks and UI mocks are different evidence from
those platform cases. Retain them in #88/#89; do not tick them from a build alone.

#82's installed-download runner stall, #46's cold-boot/painted-readiness evidence,
and full #47/#89 candidate qualification remain open. No active host reboot,
browser-store submission, account purchase or release publication occurred.
Hosted workflows were skipped under #54, never reported passed.

The [#82 follow-up and user-run Windows checklist](INSTALLED_BROWSER_QUALIFICATION.md)
records a command-line handle-inheritance regression, the launcher fix and bounded
browser diagnostics. The preceding gaps describe the earlier agent-observed
checkpoint, before the maintainer's acceptance below.

## Maintainer acceptance (2026-10-23)

The maintainer reported completing all grouped Windows tests successfully,
including corrected Chrome/Edge/cleanup, production setup/installer lifecycle,
permissions, English/Arabic and retained-state checks. This human report, together
with the implementation and local verification, completes #88's functional gate
and #82's corrected-run follow-up. No new raw logs or per-run versions were supplied.
See [acceptance and limits](INSTALLED_BROWSER_QUALIFICATION.md).

The maintainer declined recording performance numbers. #46 and full #47/#89/M6
qualification remain open; no quantitative result or new release is inferred.
