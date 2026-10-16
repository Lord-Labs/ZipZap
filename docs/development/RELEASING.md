# Release process

No release workflow or application artifacts exist yet. This checklist defines
what must be implemented and verified before publishing the first beta; it does
not authorize a release from the current documentation-only repository.

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
3. The maintainer creates the matching `v0.1.0-beta.1` tag. Do not move a published
   version tag; corrections require another version.
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
