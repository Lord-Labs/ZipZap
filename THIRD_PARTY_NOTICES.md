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

| Component                                           | Use                                  | License metadata                        |
| --------------------------------------------------- | ------------------------------------ | --------------------------------------- |
| Tokio, reqwest                                      | HTTP/HTTPS engine                    | MIT; MIT OR Apache-2.0                  |
| rusqlite / bundled SQLite                           | Local state                          | MIT; SQLite public domain               |
| serde, serde_json, uuid, tokio-util                 | Validation, state and cancellation   | MIT OR Apache-2.0 (see package notices) |
| sha2                                                | Checkpoint integrity                 | MIT OR Apache-2.0                       |
| Tauri and its dialog/opener/single-instance plugins | Desktop shell                        | MIT OR Apache-2.0                       |
| winreg                                              | Per-user browser host registration   | MIT                                     |
| Svelte, Vite, TypeScript                            | UI and build tools                   | MIT; Apache-2.0 for TypeScript          |
| Prettier and Svelte plugin                          | Formatting                           | MIT                                     |
| Playwright / Axe                                    | UI behavior and accessibility checks | Apache-2.0; MPL-2.0 for Axe             |
| tempfile                                            | Isolated test storage                | MIT OR Apache-2.0                       |

The generated notices are authoritative for exact package versions and copyright
texts. Windows system APIs/TLS and WebView2 are system/runtime dependencies with
their own Microsoft terms; they are not relicensed by ZipZap. The installer uses
Tauri's WebView2 runtime bootstrap when the required runtime is absent.

aria2 1.37.0 was used only in an optional historical comparison. It is not linked,
shipped or needed to build ZipZap. Its GPL terms therefore do not become the
application's license. No proprietary IDM binaries, assets or code are included.
ZipZap's icon and UI were independently authored with system fonts.
