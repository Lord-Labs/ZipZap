# Release process

`.github/workflows/release.yml` builds the reviewed Windows beta on manual dispatch
from protected `main`. It checks the matching version and successful required
main checks, rebuilds locked dependencies, verifies the core and installer lifecycle,
and publishes only from the `beta` environment. Its deployment branch policy
allows protected branches only. Build jobs are read-only; the publishing job
alone receives contents-write permission. There are no signing secrets.

The [2026-10-18 development policy](WORKFLOW.md) makes hosted verification
manual-only. It does not authorize a release or remove the release workflow's
successful-check prerequisite. A future release needs a separate maintainer
decision on hosted qualification before that workflow can proceed; never treat
skipped checks as a release pass.

For `0.2.0-beta.1`, the maintainer's 2026-10-20 instruction explicitly authorizes
publication and the required manual validation/release runs. The
[qualification record](DAILY_USE_QUALIFICATION.md) records the remaining cold-start
measurement gap and the distinction between release delivery and the full M6 gate.

On 2026-10-21, after the installed-browser run stalled, the maintainer explicitly
requested immediate publication. The version-specific manual route
`maintainer-exception-47` records incomplete hosted qualification as an exception,
never as a passing Repository result. It is limited to `0.2.0-beta.1`, keeps
protected main/beta and immutable packaging, and still runs core/build and
installer lifecycle checks. Browser automation is skipped in that route; #82 and
the full #47/native/browser matrix remain open alongside #46. The default route
still requires a successful exact-commit Repository check. No check status is forged.

The [daily-use beta qualification record](DAILY_USE_QUALIFICATION.md) separates
current-main preparation from the remaining #46 startup evidence and #47
candidate/installer gates. A merged implementation or passing preflight does
not qualify a new installer.

## First-beta gates

Verified for `0.1.0-beta.1` on 2026-10-17; see the
[acceptance checklist and publication record](VERIFICATION.md). Reassess these
gates for each later release.

- [x] M1–M4 are complete with the issue acceptance criteria and real integration evidence.
- [x] M5 verification and security review have no unresolved release blockers.
- [x] The Windows support matrix and known limitations match tested behavior.
- [x] Toolchains/dependencies are pinned; dependency licenses and notices are reviewed.
- [x] Installer CI builds the chosen release commit and produces SHA-256 checksums.
- [x] Clean install, upgrade, uninstall, and native-host registration are tested.
- [x] English/Arabic instructions, security support policy, and release notes are current.
- [x] Signing and SmartScreen status are disclosed accurately; no signature is claimed without verification.

## Publish through a reviewed release PR

1. Open a release issue/PR identifying the version, commit, acceptance evidence,
   outstanding limitations, and installer verification. The prepared daily-use
   candidate is `0.2.0-beta.1`; it is not published or qualified by a version bump.
2. The maintainer reviews and merges the PR with required checks passing. Release
   tooling must accept only a reviewed commit on protected `main`, use a protected
   release environment, and give write permissions only to the publishing job.
3. Dispatch **Windows beta** from `main` with the reviewed version. The publishing
   job creates the matching version tag at the exact checked build commit.
   A pre-existing release/tag is not overwritten. Corrections require another version.
4. Publish a GitHub **prerelease** with the installer, checksum manifest, release
   notes, tested Windows versions, and known limitations. Verify downloaded
   artifacts against the checksums before announcing completion.
5. Update the roadmap, release issue, and supported-version policy with the actual
   released version. Keep experimental or untested claims out of user docs.

Never expose signing keys to pull-request jobs or use ad-hoc binaries from a local
machine as if CI produced them. Signing credentials are optional until arranged;
their absence must be documented. Automatic updates remain deferred until their
signature and downgrade behavior are tested.

## Regression or vulnerability

Stop directing users to a compromised/broken build, communicate affected versions,
and publish a corrected version. Coordinate sensitive issues through
[private reporting](../../SECURITY.md). Preserve published version history and
explain replacement artifacts rather than silently changing a release binary.

## Outputs and local reproduction

`npm run desktop:build` produces the NSIS installer under
`target/release/bundle/nsis`. `npm run build:extension` produces `dist/extension`.
Unreleased #107 uses a small embedded WebView2 bootstrapper and
prepares new-profile defaults before Finish; its [specific qualification](ONE_FILE_SETUP.md)
must be completed on the new candidate. Prior installer acceptance is not reused.
The sidecar preparation step runs `scripts/licenses.mjs` and bundles notices plus
unmodified MPL source archives into the installed application directory.

CI publishes the installer, browser ZIP, third-party source ZIP, dependency
metadata, license files and SHA256SUMS.txt. The publishing job checks hashes
before creating the prerelease. Verify downloaded assets again after publication.
The release notes live in `docs/releases/<version>.md`; edit them in the reviewed
release PR. Unsigned status and untested OS/browser/physical-fault cases must stay
visible. The workflow does not sign artifacts or claim SmartScreen reputation.
