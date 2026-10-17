# Working on ZipZap

Read `README.md`, `CONTRIBUTING.md`, and the issue before changing anything.
Use `docs/ROADMAP.md` for order and `docs/architecture/` for recorded decisions.

## Current scope

The HTTP/HTTPS core, desktop, and explicit browser handoff are implemented.
Follow `docs/ROADMAP.md`, `docs/planning/NEXT_PHASE.md`, and the linked issue
for the accepted M6 reliability, daily-use, and release work. M7 issues are
decision-only studies; do not implement their features before a scoped decision.
Do not add speculative app layers or present probe results as shipped features.

## Ponytail throughout the project

Apply the [ponytail](https://github.com/DietrichGebert/ponytail) approach: the
smallest complete change, no speculative layers, and plain-language reporting.
If the skill is installed, read its `SKILL.md`; otherwise follow the principles
here. The repository does not require a particular assistant or paid service.

- Inspect affected callers, configuration, tests, and docs before editing.
- Reuse existing patterns and dependencies. Justify a new dependency.
- Finish all affected paths; preserve validation, safe error handling, security,
  accessibility, and data integrity.
- Test meaningful behavior. Do not add tests that only restate constants.
- State what changed, why, checks performed, and any remaining limitation.

## GitHub workflow

Use an issue, a short-lived branch, and a PR into `main`. Keep changes reviewable.
Run `npm run check`. Rust changes also require `cargo fmt --all -- --check`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`,
`cargo test --workspace --locked`, `cargo build --workspace --locked`, and
`node experiments/engine-strategy/compare.mjs`, and `node scripts/test-engine.mjs`. Never bypass failing CI, invent
test results, publish credentials, or merge unrelated work. Follow
`docs/development/WORKFLOW.md`.

## Research

Use [REA](https://github.com/morluto/rea) when a specific question depends on a
shipped app or runtime evidence. Ordinary source analysis does not require REA.
Follow `docs/research/README.md`: separate observations, inferences, and unknowns;
keep private artifacts outside Git; do not present planned research as completed.
