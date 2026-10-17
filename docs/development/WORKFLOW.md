# Development workflow

## One path from idea to merged change

1. **Issue:** describe the outcome, dependencies, and acceptance criteria. Bugs
   include a reproducible example. Use Discussions for unscoped questions.
2. **Ready:** confirm dependencies are complete and ownership is clear. Keep
   blocked tasks in `Todo`, with the blocking issue linked.
3. **Branch:** start from `main`, using `feat/N-topic`, `fix/N-topic`, or
   `docs/N-topic`. Move the issue to `In Progress`.
4. **Implement:** make a small complete change. Update affected tests and docs;
   record important design decisions with context and alternatives.
5. **PR:** explain the concrete result, link `Closes #N`, and report validation.
   A draft PR may be used while work or evidence is incomplete.
6. **Review:** required local checks must pass and review conversations must be
   resolved. Hosted checks are skipped unless separately requested, following
   [maintainer decision #54](https://github.com/Lord-shaban/ZipZap/issues/54)
   on 2026-10-18. Never describe skipped hosted checks as passing. The single
   maintainer may merge their own PR with recorded verification; no self-approval
   is claimed. Prefer another reviewer whenever available.
7. **Merge:** squash with a descriptive title, remove the branch, verify the merged
   tree matches the locally checked change, mark the linked issue `Done`, and close a completed milestone only
   after its exit gate is met.

The project uses the default `Todo`, `In Progress`, and `Done` statuses. During
review an issue remains `In Progress`; the linked PR shows its review state.
Maintainers update project status manually. There is no undocumented status bot.

## Repository rules

`main` requires a pull request, resolved
conversations, and linear history. Force pushes and branch deletion are blocked.
No approving-review count is required until a second active maintainer exists.
Only squash merging is enabled. Verify effective GitHub settings when changing
this policy; a documentation claim alone does not enforce a rule.

The Repository workflow has only `workflow_dispatch`; run it only on a separate
maintainer request. Its hosted status is no longer a required merge check.
Autonomous squash merges are authorized after the local checks and review
requirements above are met. The current hosted run for #53 was cancelled as
part of this decision, not recorded as a pass.

Manual CI remains unprivileged. Do not add
release tokens, registry credentials, or privileged PR workflows to run tests.
Dependabot proposes updates for npm tooling, Cargo dependencies, and GitHub
Actions; its PRs use the same checks and review policy.

## Changes and emergencies

Update issue scope and roadmap together if requirements change. Avoid unrelated
cleanup in feature PRs. Emergency fixes still use a focused PR and relevant
checks. Repair failing local checks before merging. Changes to verification
policy require an explicit maintainer decision such as #54; do not silently
weaken other branch protections. Revert regressions with a new PR; do not rewrite
public `main` history.

## Versioning

The repository tooling package is private and is not the application version.
The application begins at `0.1.0-beta.1` only when the first-beta gates pass.
Pre-1.0 compatibility changes must be called out explicitly in release notes.
There is no `develop` branch, automatic publishing, or release schedule.
