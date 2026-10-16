# Development setup

## Current repository tooling

Install Git and Node.js 24 with npm. The tested Node version is pinned in
`.node-version`; use it when reproducing CI. Node's built-in test runner and
filesystem APIs are sufficient for the small repository checker. Prettier is the
only current development dependency, pinned by `package-lock.json`.

```sh
git clone https://github.com/Lord-shaban/ZipZap.git
cd ZipZap
npm ci
npm run check
```

The same commands work in PowerShell. Do not run npm with administrator rights.
For an existing clone, use `git pull --ff-only` on a clean `main` before branching.

| Command               | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run check`       | Formatting, repository-link checks, and checker tests |
| `npm run format`      | Format supported documentation/configuration/scripts  |
| `npm test`            | Run tests for the repository checker                  |
| `npm run check:links` | Check local Markdown file targets                     |

## Rust feasibility probe

The Rust workspace currently contains only an isolated feasibility experiment,
not the production core or desktop app. Install rustup and the Windows MSVC C++
Build Tools/SDK; `rust-toolchain.toml` selects Rust 1.99.0 with rustfmt and clippy.
Linux probe builds also need system OpenSSL development libraries and pkg-config.
The GitHub Ubuntu runner currently provides them.

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
node experiments/engine-strategy/compare.mjs
```

The [experiment instructions](../../experiments/engine-strategy/README.md) explain
optional local aria2 comparison. It is not a build dependency. `Cargo.lock` pins
transitive versions; use `--locked` to detect unexpected resolution changes.

Issue #3 introduces the actual core. Issue #7 adds Tauri's remaining Windows
requirements, including WebView2, with a verified desktop build. Documentation-only
contributors need Node tooling; CI still verifies that the full repository builds.

## Optional maintainer tools

GitHub CLI (`gh`) is useful for issues, PRs, projects, and checks. Authenticate
through `gh auth login`; never copy tokens into tracked files. Ordinary
contributors can use GitHub's website and a fork without CLI authentication.

Ponytail and REA are optional assistant workflows, not build requirements. See
[agent instructions](../../AGENTS.md) and [research](../research/README.md).

## Troubleshooting

- A formatting failure is fixed with `npm run format`, then `npm run check`.
- A local-link failure identifies the source file and missing/invalid target.
  Fix the link or add the intended document; do not disable the checker.
- If `npm ci` fails, check the Node version and registry connectivity. Do not
  delete or regenerate the lockfile just to hide a mismatch.
- Never attach `.env`, browser captures, private download URLs, or credentials
  when asking for help. Use sanitized reproductions.
