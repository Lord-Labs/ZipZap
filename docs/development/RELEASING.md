# Release process

`.github/workflows/release.yml` builds the reviewed Windows beta on manual dispatch
from protected `main`. It checks the matching version and successful required
main checks, rebuilds locked dependencies, verifies the core and installer lifecycle,
and publishes only from the `beta` environment. Its deployment branch policy
allows protected branches only. Build jobs are read-only; the publishing job
alone receives contents-write permission. There are no signing secrets.

## First-beta gates

- [ ] M1–M4 are complete with the issue acceptance criteria and real integration evidence.
- [ ] M5 verification and security review have no unresolved release blockers.
- [ ] The Windows support matrix and known limitations match tested behavior.
- [ ] Toolchains/dependencies are pinned; dependency licenses and notices are reviewed.
- [ ] Installer CI builds the chosen release commit and produces SHA-256 checksums.
- [ ] Clean install, upgrade, uninstall, and native-host registration are tested.
- [ ] English/Arabic instructions, security support policy, and release notes are current.
- [ ] Signing and SmartScreen status are disclosed accurately; no signature is claimed without verification.

## Publish through a reviewed release PR

1. Open a release issue/PR identifying the version, commit, acceptance evidence,
   outstanding limitations, and installer verification. Use `0.1.0-beta.1` for the
   first beta only after the gates above pass.
2. The maintainer reviews and merges the PR with required checks passing. Release
   tooling must accept only a reviewed commit on protected `main`, use a protected
   release environment, and give write permissions only to the publishing job.
3. Dispatch **Windows beta** from `main` with the reviewed version. The publishing
   job creates the matching `v0.1.0-beta.1` tag at the exact checked build commit.
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
The sidecar preparation step runs `scripts/licenses.mjs` and bundles notices plus
unmodified MPL source archives into the installed application directory.

CI publishes the installer, browser ZIP, third-party source ZIP, dependency
metadata, license files and SHA256SUMS.txt. The publishing job checks hashes
before creating the prerelease. Verify downloaded assets again after publication.
The release notes live in `docs/releases/<version>.md`; edit them in the reviewed
release PR. Unsigned status and untested OS/browser/physical-fault cases must stay
visible. The workflow does not sign artifacts or claim SmartScreen reputation.
