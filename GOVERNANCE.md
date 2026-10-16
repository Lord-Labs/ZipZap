# Governance

ZipZap currently has one maintainer: [Lord-shaban](https://github.com/Lord-shaban).
The maintainer sets scope, triages issues, reviews changes, manages releases,
and moderates the project's spaces.

## Decisions

Propose ordinary changes in an issue or pull request. Record consequential
architecture choices in `docs/architecture/` with context, alternatives, decision,
and consequences. The maintainer makes the final decision after considering
evidence and contributor feedback. Decisions may be revisited with new evidence.

## Merge policy

- Work through an issue and a focused PR; `main` must pass required CI.
- Use squash merges with a descriptive PR title. Keep merged branches disposable.
- There is no mandatory approving-review count while there is only one maintainer;
  GitHub prevents an author from approving their own PR. Self-authored changes must
  still use a PR, CI, and a written verification record.
- Main-branch rules prohibit force pushes and deletion and require resolved
  conversations. Introduce a second-person approval rule when another active
  maintainer can consistently review changes.

GitHub's effective settings are authoritative. See the
[workflow](docs/development/WORKFLOW.md) for contributor steps and emergency fixes.

## Adding maintainers

After sustained contributions and sound review judgment, the existing maintainer
may propose an additional maintainer in a public issue, allow discussion, and
record the decision here. Grant only the GitHub access required for the role.

## Releases and funding

Only maintainers publish releases, following the [release gates](docs/development/RELEASING.md).
There is no funding or sponsorship arrangement at present. Any future policy
will be documented before links or collection mechanisms are introduced.
