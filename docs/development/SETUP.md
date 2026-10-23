# Development setup

Use Git, Node.js 24 (see `.node-version`), npm and Rust 1.99.0
(`rust-toolchain.toml`). Windows desktop work needs the MSVC C++ Build Tools,
Windows SDK and Microsoft Edge WebView2 runtime. Use a Windows x64 host to
package the desktop; Linux verification covers the core and frontend only.

```sh
git clone https://github.com/Lord-shaban/ZipZap.git
cd ZipZap
npm ci
node scripts/build-native.mjs
npm run desktop:dev
```

The sidecar preparation step is required before Windows workspace compilation
because Tauri embeds its bundle metadata at compile time. `desktop:build` runs
that step automatically. Do not run build tools as administrator.

On Windows this also prepares the hash-pinned media resources and license texts
from `tools/media/manifest.json`. Build-time network access is needed on the first
run; verified archives are cached in ignored `.research-local/media-assets/`.
`npm run build:media` rebuilds only generated `dist/media/`. The installed app
requires no external Python/Node setup. See [video boundaries](VIDEO_ACTION.md).

| Command                   | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `npm run check`           | Formatting, local links, checker tests and Svelte/TypeScript |
| `npm run format`          | Format source and docs                                       |
| `npm run build:web`       | Production frontend                                          |
| `npm run build:extension` | Typed extension in `dist/extension`                          |
| `npm run desktop:dev`     | Real desktop app with Vite                                   |
| `npm run desktop:build`   | Windows release executable and NSIS installer                |
| `npx playwright test`     | UI contract, keyboard, RTL and Axe tests                     |

Install Playwright's test browser with `npx playwright install chromium`.
Linux UI checks use `npx playwright install --with-deps chromium`.

## Required Rust and integrity checks

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
node experiments/engine-strategy/compare.mjs
node scripts/test-engine.mjs
```

The HTTP/TLS fixture needs OpenSSL (`openssl` on Linux, Git for Windows' bundled
OpenSSL on Windows). It creates a temporary localhost CA, trusts it only inside
its child test process, and never changes the OS trust store. Linux core builds
need OpenSSL development headers and pkg-config. `Cargo.lock` and the npm lockfile
are committed; keep `--locked` and use `npm ci`.

See [engine behavior](ENGINE.md), [desktop integration](DESKTOP.md),
[user instructions](../USER_GUIDE.md) and [workflow](WORKFLOW.md).
Documentation-only contributors can run Node checks. Hosted verification is
manual-only by [maintainer decision #54](https://github.com/Lord-shaban/ZipZap/issues/54)
and must not be run without a separate request. Required local checks remain in
force. GitHub CLI is optional for contributors. Ponytail and REA are optional
assistant workflows, never paid build requirements.

## Troubleshooting

Close an app running from `target/debug` before rebuilding its executable on
Windows. If the native host is missing, build/copy the sidecar and use Connect
Chrome / Edge in settings. A blocked download, duplicate destination or
unsupported filesystem must be fixed at its cause; do not disable validation.
Do not attach databases, `.env`, cookies or private URLs to public issues.
