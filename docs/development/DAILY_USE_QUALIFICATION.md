# Daily-use beta qualification: issue #47

Preparation recorded on 2026-10-20 against reviewed main
`dd2ad091a4c4d4c2dee7d12f64d6ffb6cbd82506`, after PR #76. This is a preflight
record, not candidate acceptance. Only `0.1.0-beta.1` is published. The proposed
`0.2.0-beta.1` version has not been applied or packaged here.

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
Repository checks and offers only `0.1.0-beta.1`; do not remove that gate as a
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
