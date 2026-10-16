# Desktop and browser integration

`apps/desktop/src-tauri` owns native dialogs, the single app instance, the queue
and seven bounded commands. The frontend has no shell, filesystem or HTTP plugin
permissions. Only the local main window receives its capability. Release CSP
allows local bundled resources and Tauri IPC, not arbitrary remote web content.
Files are opened only after looking up a completed job by ID.

The native host validates the exact extension origin, a native-endian 32-bit
frame length of 1–32768 bytes, a versioned schema with unknown fields rejected,
and the shared HTTP/HTTPS URL rules. It durably writes a request under a random
UUID then atomically renames it into the per-user inbox. The application polls
every 500 ms, validates files/schema, and adds through `Manager::add_with_id`.
Repeated delivery of the same UUID is idempotent. The host acknowledges receipt,
not successful file completion. Inbox quota is 100 files; queue quota is 1000.
The sidecar's stdout is reserved for framed responses. There is no network
control listener or arbitrary command/file operation in the bridge.

The extension key in `identity.json` is a public identity key, not a secret.
The allowed unpacked extension ID is `binbcpkdchddgajmemjmhakpamjdkhpl`.
The native host name is `com.zipzap.native`. Store publishing with another ID
requires an explicit reviewed origin/identity change, not a wildcard.

## Checks

- `npx playwright test`: frontend behavior, RTL, focus and Axe checks with a
  mocked Tauri contract; this does not prove native downloads.
- `cargo test -p zipzap-native --locked`: real framing/origin/schema validation.
- `node scripts/e2e-fixture.mjs`: bounded local HTTP source for manual app tests.
- `node scripts/test-browser.mjs <fixture-url> <app-default-folder>`: real
  unpacked extension/native host/desktop/digest checks on a Windows test install.
  Use a fresh destination with no conflicting output filenames.

Browser test profiles are isolated from personal profiles. Modern branded
browsers can restrict command-line extension loading; successful Chromium tests
must not be reported as Edge verification. Record actual browser versions and
manual installation evidence separately when command-line loading is unavailable.
