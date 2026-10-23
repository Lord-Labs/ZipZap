# Daily-use beta qualification: issue #47

This record preserves dated preparation snapshots below. Later publication
authorization and hosted results supersede their pending-release status, without
turning unmeasured cold-start evidence into a pass. #46 and full M6 remain open.

Preparation recorded on 2026-10-20 against reviewed main
`dd2ad091a4c4d4c2dee7d12f64d6ffb6cbd82506`, after PR #76. This is a preflight
record, not candidate acceptance. Only `0.1.0-beta.1` is published. At this
preflight snapshot, `0.2.0-beta.1` had not yet been applied or packaged.

Issues #29–#45 are closed; #46 remains open for repeated real cold-boot startup
and precise painted-readiness evidence/budgets. The maintainer approved merging
its completed measurement slice while retaining that gap. #47 stays Todo, blocked
for complete qualification; this preparation does not close either issue or M6.
M7 studies are separate decisions, not release blockers.

## Source and dependency identity

Production source matches the [performance baseline](../research/performance.md):
core tree `7f41e0a5043a307632bc42190536ec76027a7eac`, desktop tree
`6f243a29a9453f40e33644c9207caefedd4b6d96`. Preflight used Windows 11 x64 build
26200, Node 24.19.0 and Rust 1.99.0. Builds/tests ran concurrently; their elapsed
times are not performance measurements.

| Input             | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Cargo.lock        | `7cc2e139b1e15fdca37c81a2a899566dd5edaa369ac74c739d1caf88dc4f2d54` |
| package-lock.json | `666c4c1757874d266933b1561bf733906e42e5d7d53c2d705f8fb70cf3f0c5ac` |

## Local preflight results

These checks exercise current main and do not establish installed-app behavior.
The same production trees must be reverified when a candidate is frozen.

| Check                                                            | Observed result                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                  | Passed on the identical pre-merge tree; five Node tests, zero Svelte errors/warnings. Repeated after these documentation edits.           |
| `cargo fmt --all -- --check`                                     | Passed.                                                                                                                                   |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed.                                                                                                                                   |
| `cargo test --workspace --locked`                                | All 70 tests passed across core, desktop, probe and native-host suites.                                                                   |
| `cargo build --workspace --locked`                               | Passed.                                                                                                                                   |
| `node experiments/engine-strategy/compare.mjs`                   | All six Rust probe scenarios passed; aria2 was not compared.                                                                              |
| `node scripts/test-engine.mjs`                                   | All 48 production scenarios passed, including first-beta state migration/resume, integrity, TLS, recovery and real local-time scheduling. |
| `npm run build:web` / `npm run build:extension`                  | Both passed.                                                                                                                              |
| `npx playwright test`                                            | All 45 tests passed, including English/Arabic, browser feedback and Axe checks. Desktop IPC/native messaging are mocked here.             |
| `./scripts/test-native-performance.ps1`                          | All eight refusal cases passed without launching a window.                                                                                |
| `node --check scripts/benchmark-performance.mjs`                 | Passed. The timed benchmark/native collection was not repeated.                                                                           |

Hosted GitHub checks were **skipped**, not passed, under #54. No workflow was
dispatched. The retained release workflow still requires successful hosted
Repository checks; do not remove that gate as a
side effect of preparation. A separate maintainer decision is needed before
hosted release qualification, followed by separate publication authorization.

## Dependency, packaging and boundary review

`npm audit --json` reported zero vulnerabilities. The existing local
`cargo-audit 0.22.2` reported zero vulnerability advisories using database commit
`e6f94f3760d5e6c54c1b05f204002263bc025524` (1,348 advisories). Its informational
warnings were retained:

| Package                | Advisory          | Kind                             |
| ---------------------- | ----------------- | -------------------------------- |
| proc-macro-error 1.0.4 | RUSTSEC-2024-0370 | Unmaintained                     |
| glib 0.18.5            | RUSTSEC-2024-0429 | Unsound iterator implementations |
| zbus_names 4.3.5       | RUSTSEC-2026-0371 | Unmaintained                     |
| zvariant 5.15.1        | RUSTSEC-2026-0370 | Unmaintained                     |
| zvariant_derive 5.15.1 | RUSTSEC-2026-0372 | Unmaintained                     |

For each listed package, `cargo tree --locked --target x86_64-pc-windows-msvc -i
<package>` returned no dependency path. These warnings concern other target
resolution in the lockfile; they are not suppressed or a qualification of those
platforms. Refresh both audits at the candidate commit.

`node scripts/licenses.mjs .research-local/qualification-47/notices` succeeded:
371 dependency entries (310 Cargo, 61 installed npm), license texts and all five
Cargo MPL source archives. Supplemental notice hashes were checked by the
collector. The generated outputs remain ignored locally:

| Output                   | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| THIRD_PARTY_LICENSES.txt | `8f1f57abb7bde8ba2dc27d7404675b63c075c932cdb8f20cd7b228f03eab478d` |
| dependencies.json        | `da4736c03f08ad091dc028990d8b1ecbc4939d4597c3a492a141872309033c92` |

The built extension's public-key-derived identity was asserted equal to
`binbcpkdchddgajmemjmhakpamjdkhpl`; its permissions were asserted exactly
`contextMenus` and `nativeMessaging`. Source review covered the exact native
origin/frame/result checks, the local-only Tauri capability/CSP, explicit
completed-file Open/provenance confirmation, support-summary allowlist and
installer registration hooks. This supplements the [security review](SECURITY_REVIEW.md)
and [ADRs](../architecture/0001-project-direction.md); it is not an independent
security audit, installed-browser check, malware certification or signing result.

## Remaining candidate gates, in order

1. Complete #46 with independent real boot sessions and exact startup definitions
   using the [prepared collector](../research/performance.md). Fresh profiles,
   process restarts and tool-delayed observations do not substitute. Never reboot,
   suspend or sign out the active work host for evidence.
2. Freeze a reviewed candidate with proposed `0.2.0-beta.1` app/Cargo versions,
   a matching numeric extension version, refreshed audits/notices and bilingual
   release notes. Record commit,
   toolchain, executable/installer hashes and any source changes after preflight.
   Review the manual workflow's version choice and hosted-check decision in that
   release PR. Keep automatic updates disabled.
3. On a disposable Windows user/VM, install the published beta.1 and create owned
   completed files, valid paused partials and saved settings. Upgrade through the
   candidate installer; verify migrated state, resume/output hashes, queue order,
   scheduler/tray behavior and provenance. Exercise same-version repair,
   uninstall/reinstall, registration cleanup and retained files/settings/partials.
   Record a coherent closed-app pre-upgrade backup/recovery procedure. Older
   binaries must reject newer schemas; never lower `user_version` manually.
4. Repeat the [native scenarios](NATIVE_SMOKE.md) on that same candidate, including
   Arabic/English keyboard/scaling, dialogs/export, explicit tray/notifications,
   real sleep/resume, schedule boundaries and restart recovery. Historical
   maintainer-reported acceptance stays distinct from candidate observations.
5. Repeat Chrome/Edge protocol-v2 open/closed-app, held queue, receipt/queued/
   rejected, timeout/missing-host and UUID replay checks with isolated profiles,
   exact identities and verified payload hashes. `scripts/test-browser.mjs`
   covers only a subset; it is not sufficient for the whole v2 matrix.
6. Verify the actual installer's signature status and disclose unsigned limits
   if no signing is available. Review packaged notices/source archives and create
   a checksum manifest for every immutable artifact. Qualification must refer to
   one reviewed commit; no current installer/signature/checksum result is claimed.
   Publish only after a separate explicit maintainer release instruction.

`scripts/test-installer.ps1` uses the normal `com.zipzap.desktop` state and both
normal native-host registry keys. A workspace install path alone does not isolate
those resources. Run it only in the disposable Windows session; it neither proves
a beta.1 cross-version upgrade nor substitutes for the extended lifecycle matrix.
Do not use it against personal state or replace normal registrations on this host.

## Candidate preparation continuation: 2026-10-20

The maintainer reported that all tests succeeded and requested continuation
after reviewing the preparation summary. This is maintainer-reported acceptance,
separate from agent-observed checks. No per-scenario candidate identity, cold-boot
raw repetitions, painted-readiness timings or new startup budgets were supplied;
none are inferred. #46 retains that quantitative evidence gap. Tests of earlier
builds cannot establish lifecycle acceptance of a subsequently built installer.

The candidate branch applies `0.2.0-beta.1` to desktop/core/native manifests and
lockfiles and `0.2.0` to the Manifest V3 extension, retaining its public identity
and minimal permissions. The initial UI version and HTTP user agent follow their
package versions. The manual release workflow offers the new version, retaining
its successful-hosted-check and protected publishing gates; no dispatch is implied.
Draft release notes are available in [English](../releases/0.2.0-beta.1.md) and
[Arabic](../releases/0.2.0-beta.1.ar.md). README/security support still identifies
the published first beta. Candidate build/verification evidence follows when run;
neither #47 nor M6 is complete from packaging alone.

### Local candidate build and checks

Built from clean commit `aaeecaffa47758c5ac1adecb1c176f5687464651` in PR #78:
core tree `0e3fe3576d903cafbb5f22c700512faa34e3149e`, desktop tree
`1b278549d058342c3a7f12e91f53e5a19d5be38c`. Later evidence-only documentation
does not change these build inputs. Third-party dependency graphs are unchanged;
only workspace version entries changed in the lockfiles:

| Input             | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Cargo.lock        | `4690200a28fca92a2063b47ee5b8c002ac014bb7b1f059ef240646754418b686` |
| package-lock.json | `05a845c037ca97f402cd22df7b9fece73897bc7de91450ef895a6a496e96a47f` |

- `npm run check` passed with five Node tests and zero Svelte errors/warnings.
  Rust formatting, clippy with warnings denied, all 70 workspace tests and the
  locked workspace build passed. The six Rust probe scenarios and all 48
  production engine scenarios passed, including migration/resume, exact output,
  publication/storage failures and real local-time scheduling.
- The first `npx playwright test` run used eight workers alongside Rust
  verification: 43 passed and two hit the unchanged 30-second deadline. Recovery
  details stalled during an evaluation (16.2 s in the trace); schedule navigation
  timed out before its test body. Failed traces were preserved privately before
  rerunning. Both tests passed alone with `--workers=1` (4.9 s / 1.4 s), then
  all 45 passed with `npx playwright test --workers=2` (52.7 s). No source or
  timeout was changed between runs. Contention is a hypothesis, not a diagnosed
  root cause or repaired product defect; the failed run remains a failed run.
- A separate loopback transfer checked the compiled core's support-summary
  version and actual HTTP `User-Agent`: `0.2.0-beta.1` and
  `ZipZap/0.2.0-beta.1`, with an intact completed empty output. Built extension
  version `0.2.0`, original identity and exact minimal permissions were asserted.
- Refreshed npm/Cargo audits again reported zero vulnerability advisories with
  the same advisory database commit and five informational warnings above.
  License collection again succeeded for 371 entries and five Cargo MPL archives.
- `npm run desktop:build` passed, including release native sidecar, frontend,
  desktop and NSIS packaging. Windows executable ProductVersion is
  `0.2.0-beta.1`; executable SHA-256 is
  `65031abf3e4544ce80a545681ae72d60f6ba13f05b7ca95b01904abeb483d4fa`.
  `Get-AuthenticodeSignature` reports **NotSigned** for the installer.

The local candidate folder is
`.research-local/qualification-47/candidate-aaeecaf/`. It contains the same six
payload kinds as the retained release workflow. Every entry in the browser ZIP
(10 files) and source ZIP (five archives) was hashed against its source; all
matched. All six checksum-manifest entries were reread and verified:

| Local payload                               | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| ZipZap_0.2.0-beta.1_x64-setup.exe           | `1972bd9ca3b9291c72ffbe057da2c299a947bdd1d9a9116fd603115c63c702b1` |
| ZipZap_browser_0.2.0-beta.1.zip             | `ad4909a5f2bb9836123d35f1a4a9c9d3f03714095959fbb9e69015f0293c5015` |
| ZipZap_third-party-sources_0.2.0-beta.1.zip | `b4e276a972471923161d52d22095541ec0ca675268070f23d5f6e425813ab1b8` |
| THIRD_PARTY_LICENSES.txt                    | `8f1f57abb7bde8ba2dc27d7404675b63c075c932cdb8f20cd7b228f03eab478d` |
| dependencies.json                           | `da4736c03f08ad091dc028990d8b1ecbc4939d4597c3a492a141872309033c92` |
| LICENSE                                     | `86c61424f3af99d567c4386400a28c9f47b0e33a6228a59b671c81797b266120` |

Installer size: 4,175,830 bytes. `SHA256SUMS.txt` SHA-256:
`ecaf60840da28fbf22b64d117738ad042b533be3de573a39f3d4cb620c5d7993`.
These are local candidate hashes, not hosted-build or published-release hashes;
do not reuse them for a later rebuilt artifact without comparison. Bit-for-bit
rebuild reproducibility was not tested.

No candidate installer was executed, no active-desktop/native-browser lifecycle
was driven and no normal state/registration changed. The same-candidate
upgrade/repair/uninstall/reinstall, native/browser/OS-session matrix and raw #46
cold-start evidence remain release gates. Hosted checks were skipped under #54,
not passed; no workflow, tag or release was created.

## Publication authorization and remaining scope

On 2026-10-20, after the candidate results and missing cold-start/installer
evidence were disclosed, the maintainer explicitly instructed publication,
repository/website updates and new screenshots. This authorizes the necessary
manual Repository and Windows beta release runs for this release only; automatic
hosted checks remain disabled under #54. No skipped check becomes a pass.

The release uses the protected workflow and its exact-commit Repository check
prerequisite. Installer verification now refuses existing user state/registration,
installs the published first beta after verifying its immutable SHA-256, upgrades
to the candidate, checks a synthetic schema-1 migration plus completed/partial
bytes and settings, verifies installed Chrome/Edge downloads, and exercises
repair and uninstall/reinstall retention. The synthetic records are not claimed
to have been created by the old GUI. Node seed/migration assertions and PowerShell
parsing passed locally without installing anything; actual installed outcomes
must come from the disposable Windows runner before publication.

Publication is an explicitly requested beta delivery with the quantitative cold-
boot/painted-readiness gap disclosed, not a claim that #46 or the full M6 exit
gate is complete. No active-host reboot, sleep, privacy/security setting change,
warning bypass or invented timing is authorized or needed. Retain #46 as a
follow-up, and update #47/tracker with actual hosted/release results separately.

## Hosted verification correction (2026-10-21)

PR #78 merged as `88372e19cdef8ab3e906fd20f95b5cb6d2e54475`.
The first authorized [Repository run](https://github.com/Lord-shaban/ZipZap/actions/runs/39527015548)
passed Ubuntu but failed Windows in the engine fixture: TEMP used the 8.3 alias
`RUNNER~1` while the core returned the full `runneradmin` folder. Installer checks
were not reached, and the aggregate check failed. This is retained as a failure.

[PR #80](https://github.com/Lord-shaban/ZipZap/pull/80), for #79, canonicalizes
the owned fixture root once and its guarded cleanup parent. Exact category and
explicit-folder assertions remain; production validation is unchanged.
`npm run check` and all 48 engine scenarios passed locally with TEMP/TMP deliberately
redirected through a filesystem junction. The fix merged at
`3910ca549fd62034999371cfb9ae8c84ec24517b`. The fresh
[Repository run](https://github.com/Lord-shaban/ZipZap/actions/runs/39527944143)
passed Ubuntu and Windows formatting/clippy/tests/build/probe/engine/NSIS steps.
Its installer phase also logged successful first-beta upgrade, same-version repair,
schema-1-to-5 migration and settings/completed/partial retention. Installed Chromium
156.0.8078.4 completed 1 MiB with SHA-256
`b8a74bb29f5cab9c4aa7e78d78053b0c23ef8cbbaccd8796396659e39eb3623c` through
extension `binbcpkdchddgajmemjmhakpamjdkhpl`.

The browser script then stopped producing results before Edge/later lifecycle
outcomes. The run was cancelled at 01:51 UTC to retrieve diagnostics; it is
**cancelled**, not passed. The exact stall point/root cause is unconfirmed.
[#82](https://github.com/Lord-shaban/ZipZap/issues/82) retains reproduction,
bounded diagnostics and both browser exit/Edge acceptance as follow-up work.
No later uninstall/reinstall outcome is inferred from that cancelled run.

## Explicit incomplete-qualification release exception (2026-10-21)

After that stall, the maintainer explicitly requested immediate publication and
asked to record success. A false success was declined: failed/cancelled results
remain unchanged. [PR #83](https://github.com/Lord-shaban/ZipZap/pull/83), merged
as `e1edf759dad1292c1050025bde177fb2439d8718`, adds a separately selected
`maintainer-exception-47` route limited to `0.2.0-beta.1`. It records an explicit
warning/summary, keeps protected main/beta, version checks and immutable artifacts,
and still runs locked builds/core and installer lifecycle without browser automation.
The default route retains its exact-commit Repository-success prerequisite.
No GitHub check status was forged, no protections were disabled, and no user
device control was used.

`npm run check` passed. Eight local assertions exercised the actual extracted
PowerShell gate using an isolated read-only API stub: normal success/absence/wrong
app, the version-specific exception, unknown route, configured-version mismatch
and API failure. Exception disclosure was asserted. These are synthetic gate
tests, not hosted-check results. Product source and dependencies did not change.

The authorized [Windows beta run](https://github.com/Lord-shaban/ZipZap/actions/runs/39530014651)
builds `e1edf759dad1292c1050025bde177fb2439d8718`; actual publication/artifact
verification is recorded below after completion. #46, #47, #82 and the full M6
qualification gate remain open. No full native/browser matrix or repeated
cold-boot/painted-readiness acceptance is claimed by this delivery exception.

## Published daily-use beta (2026-10-21)

[0.2.0-beta.1](https://github.com/Lord-shaban/ZipZap/releases/tag/v0.2.0-beta.1)
was published from `e1edf759dad1292c1050025bde177fb2439d8718` by
[Windows beta run 39530014651](https://github.com/Lord-shaban/ZipZap/actions/runs/39530014651).
Both build and publish jobs succeeded using the explicit exception above. No
Repository-success status was created; those earlier run conclusions are unchanged.
The production core/desktop/browser trees and lockfiles match clean build input
`aaeecaffa47758c5ac1adecb1c176f5687464651`; later changes concern tests,
release orchestration and documentation.

The release run passed npm checks, Rust formatting/clippy, 70 workspace tests,
locked builds, six probe and 48 engine scenarios, release desktop/NSIS and extension
builds. Its disposable installer phase passed first-beta upgrade, same-version
repair, schema-1-to-5 migration with settings/completed/partial retention, uninstall
and registration cleanup, reinstall after uninstall, and a second uninstall with
retained state/files. Browser automation was explicitly **skipped**, not passed.

All seven published assets were independently downloaded. Exactly six payloads
matched every `SHA256SUMS.txt` entry, with no missing/extra payloads; the lightweight
tag and release target both match the checked build commit above. Every browser
ZIP file and all five MPL source archives match the verified local source payloads.
The three landing-page asset URLs (installer, extension and manifest) were also
checked without authentication before switching the site.

| Published payload                           | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| ZipZap_0.2.0-beta.1_x64-setup.exe           | `813a480bd224677a6d483c7ab49d84b26987f403c773cfc8c0eb44d18f934e54` |
| ZipZap_browser_0.2.0-beta.1.zip             | `c58cdc9f0090a3f5c55c3f4965cfa60b948bd1c9824332fd0bb7257572cba23b` |
| ZipZap_third-party-sources_0.2.0-beta.1.zip | `7b627a714e0fa6063fffb227bc7fd0d826f4cb6def09033a12511b77ab405891` |
| THIRD_PARTY_LICENSES.txt                    | `77edb98f24f16f91c91afe2e1011f3dba4becfa844bda8519b68622a6b9f40bc` |
| dependencies.json                           | `504029f927f341189886dd9265395e51c063c1041b9381d8d19655f0f132c468` |
| LICENSE                                     | `86c61424f3af99d567c4386400a28c9f47b0e33a6228a59b671c81797b266120` |

Published installer: 4,185,963 bytes, Authenticode `NotSigned`.
Published manifest SHA-256:
`befc2e6f3a6174d16cce5ea652aaf874b05aa445e89eb661a708ed1bfe6ea746`.
These are the actual hosted/published hashes, distinct from the earlier local
candidate. Bit-for-bit rebuild reproducibility, full native/browser qualification
and raw cold-boot readiness remain unclaimed. #46/#47/#82 and M6 remain open.

GitHub temporarily auto-closed #46 when the negated closing phrase in PR #78
matched its keyword parser. The PR wording was corrected and #46 reopened on
2026-10-21, restoring the maintainer's explicit decision; no missing measurement
was inferred from that temporary tracker state.

## Landing page and repository refresh (2026-10-21)

[Website PR #4](https://github.com/Lord-shaban/zipzap-website/pull/4) merged as
`3d4fa7e7857d8802ec4d8720bc74aae121e9ebf0`. Existing Vercel Git deployment
`dpl_FjiUhZgt3tQCfy5PmdZkwRAC7Esk` reached production `READY` at
[zipzap-website.vercel.app](https://zipzap-website.vercel.app). Anonymous HTTP
checks confirmed current version copy and both deployed native screenshot hashes.
The installer, extension, manifest and release-note links target the verified beta.

Local site checks/build passed. Headless Chromium verified the deployed site in
English/Arabic at 320/375/768/1024/1440 px: correct language/RTL and current images,
no horizontal overflow, zero Axe violations, mobile menu/Escape, sample progress/
pause/reset and FAQ expansion. These are website checks, not native app tests.
The new captures' [provenance](../images/README.md) distinguishes the actual
isolated debug host with production frontend from installed-release evidence.
No further control of the user's device was used.

## Post-beta functional acceptance (2026-10-23)

PR #106 fixes a command-line-proven native handle leak and bounds installed
Chrome/Edge and cleanup diagnostics. Required local checks passed, including
all 90 Rust tests, six comparison cases and 48 engine cases. The local installer
was built and its contents checked; [exact hashes and limits](INSTALLED_BROWSER_QUALIFICATION.md)
distinguish it from the published beta.

After receiving the grouped Windows checklist, the maintainer reported all tests
performed successfully and requested continuation. This supplies human-reported
functional acceptance for #82/#88, including the corrected browser runners and
setup/installer/permission checks. No new per-run logs or environment versions
were supplied, and the maintainer declined recording performance numbers.
No quantitative result is inferred: #46, full #47/#89 and M6/#28 remain open.
The earlier cancelled run and published-beta exception remain unchanged.
Hosted checks remain skipped under #54. No new release or store listing occurred.
