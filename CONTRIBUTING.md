# Contributing to ZipZap

Thank you for helping. ZipZap has published its first Windows beta; start with the
[next-phase plan](docs/planning/NEXT_PHASE.md), [roadmap](docs/ROADMAP.md) and
[open issues](https://github.com/Lord-shaban/ZipZap/issues).
An issue's acceptance criteria define the work. Discuss changes to scope before
spending time on a large implementation.

## Make a contribution

1. Pick an issue whose dependencies are complete. Comment that you would like to
   work on it; a maintainer confirms ownership to avoid duplicate work.
2. Fork the repository (maintainers may create a branch directly), then branch
   from current `main`: `feat/3-http-download`, `fix/42-resume`, or `docs/15-setup`.
3. Follow [setup](docs/development/SETUP.md). Make the smallest complete change,
   including affected callers, docs, and meaningful verification.
4. Run `npm run check` and the relevant [Rust/fixture checks](docs/development/SETUP.md)
   for Rust or experiment changes. Report commands and actual results in the PR.
5. Open a PR against `main`, link the issue with `Closes #N`, and use the template.
   Draft PRs are welcome. Remove private URLs, tokens, cookies, and local paths
   from logs and screenshots.
6. Address review and CI failures. Maintainers squash-merge after the acceptance
   criteria are met; merging closes the linked issue.

Use a title such as `feat: add safe resume` or `docs: explain Windows setup`.
Allowed prefixes are `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`,
`ci`, and `chore`. Commit titles should describe the result in plain language.

## Keep changes focused

- Reuse existing code and platform APIs before adding dependencies or wrappers.
- Add a focused regression test for a bug or a meaningful test for new logic.
- Preserve validation, error handling, accessibility, and data integrity.
- Record a new architecture decision only for a consequential boundary or tradeoff.
- Never claim tests passed if they were skipped. Explain limitations directly.
- AI-assisted contributions follow the same review, attribution, and verification
  requirements. Contributors remain responsible for what they submit.

English is the default language for code and shared technical docs. Arabic and
English are both welcome in issues and discussion. Keep translated user docs
consistent when changing shared product information.

## License and community

By contributing, you agree to license your contribution under the repository's
[MIT License](LICENSE). Preserve third-party notices and cite external material.
There is no CLA or contributor certificate requirement.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports belong in the
[private reporting process](SECURITY.md), not public bug reports.
