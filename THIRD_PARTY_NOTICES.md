# Third-party dependencies

ZipZap's code is MIT. Dependencies retain their own terms. The committed Cargo
and npm lockfiles pin versions and integrity data. `scripts/licenses.mjs` collects
actual license/notice texts for the Windows dependency closure and installed npm
tooling, plus metadata, before packaging. The installer includes
`THIRD_PARTY_LICENSES.txt` and exact unmodified source archives for MPL packages;
the release also provides a source archive ZIP and `dependencies.json`.

The collection is intentionally broader than runtime: it includes build/test
packages and the isolated feasibility probe. Linux/macOS dependencies outside the
Windows graph are not a claim of distributed platform support. See the
[security/license review](docs/development/SECURITY_REVIEW.md) and
[supplemental notice provenance](licenses/third-party/README.md).

## Direct components

Unreleased Windows builds also bundle full unmodified CPython 3.14.9 embedded
x64, Node 24.22.1 (executable and full license), and the pure yt-dlp 2026.10.21
archive with EJS 0.8.0, meriyah 6.1.4 and astring 1.9.0. These supply explicit
metadata extraction only. Exact inputs and hashes are in
[`tools/media/manifest.json`](tools/media/manifest.json) and
[ADR 0012](docs/architecture/0012-public-video-action.md).
The installer presents CPython's full license including bundled third-party and
Windows redistribution terms. Installed notices include the complete Python/Node
texts and Unlicense/ISC/MIT notices. No FFmpeg or yt-dlp PyInstaller executable is
distributed. `npm run build:media` prepares verified resources before packaging;
the installed application never downloads or auto-updates its tools.

| Component                                                        | Use                                     | License metadata                        |
| ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| Tokio, reqwest                                                   | HTTP/HTTPS engine                       | MIT; MIT OR Apache-2.0                  |
| rusqlite / bundled SQLite                                        | Local state                             | MIT; SQLite public domain               |
| serde, serde_json, uuid, tokio-util                              | Validation, state and cancellation      | MIT OR Apache-2.0 (see package notices) |
| sha2                                                             | Checkpoint integrity                    | MIT OR Apache-2.0                       |
| Tauri and its dialog/opener/single-instance/notification plugins | Desktop shell, tray and notifications   | MIT OR Apache-2.0                       |
| winreg                                                           | Per-user browser host registration      | MIT                                     |
| windows-sys                                                      | Windows publication file identity       | MIT OR Apache-2.0                       |
| windows-version                                                  | Numeric Windows version in support data | MIT OR Apache-2.0                       |
| native-tls, httpdate                                             | TLS failure classification, HTTP dates  | MIT OR Apache-2.0                       |
| Jiff                                                             | Local queue schedule and DST rules      | Unlicense OR MIT                        |
| Svelte, Vite, TypeScript                                         | UI and build tools                      | MIT; Apache-2.0 for TypeScript          |
| Prettier and Svelte plugin                                       | Formatting                              | MIT                                     |
| Playwright / Axe                                                 | UI behavior and accessibility checks    | Apache-2.0; MPL-2.0 for Axe             |
| tempfile                                                         | Atomic support export and test storage  | MIT OR Apache-2.0                       |

The generated notices are authoritative for exact package versions and copyright
texts. Windows system APIs/TLS and WebView2 are system/runtime dependencies with
their own Microsoft terms; they are not relicensed by ZipZap. The installer uses
Tauri's bundled Evergreen WebView2 bootstrapper to download/install the runtime
from Microsoft only when it is absent. Microsoft distributes that shared runtime under its own terms; it keeps
its normal update behavior and is retained when ZipZap is removed. See
[Microsoft's deployment documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).

aria2 1.37.0 was used only in an optional historical comparison. It is not linked,
shipped or needed to build ZipZap. Its GPL terms therefore do not become the
application's license. No proprietary IDM binaries, assets or code are included.
ZipZap's icon and UI were independently authored with system fonts.
