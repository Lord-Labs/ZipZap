# IDM desktop reference

- Date: 2026-10-17.
- Implementation issue: [#25](https://github.com/Lord-shaban/ZipZap/issues/25).
- Question: which visible parts of the installed IDM workspace can improve
  ZipZap's existing download controls without adding another engine or unsupported features?
- Target: installed `IDMan.exe`, product/file version `6, 43, 15, 2`,
  6,201,712 bytes, SHA-256
  `e3fc655a335e17a6fdd09a9b315291d0c8863180f0d801e5dd7433c9e56afbd8`.

## Evidence and observations

REA 6.5.0 CLI `inspect-pe-resources` succeeded using its built-in PE resource
parser (provider version 1). Evidence ID:
`ev_e87a40d1c86278f7e90ee77d18a4a707b9bc112dc8951623c56df8791c79427e`.
It reports PE32, 887 examined resource-directory entries, 436 resources and
complete coverage **of the resource inventory**. It retains payload locations,
hashes and icon-group references. Other payloads are opaque; this does not
decode the UI or establish any download algorithm. Complete output remains in
ignored local research storage; no proprietary payload is copied into Git.

Separate Windows Computer Use observations of the running IDM 6.43 main window,
in Arabic with a dark appearance, showed:

- A compact toolbar above a category pane and a download table.
- Categories for compressed files, documents, music, programs and video, plus
  incomplete/completed downloads and queued work.
- Columns for filename, size, status, remaining time and transfer rate. The
  accessibility tree also exposes dates, description, destination and referrer.
- No active row selected: several toolbar controls are disabled.

These are screenshot/accessibility observations, **not REA runtime Evidence**.
Only the main window was inspected; personal history and raw captures are not
included here. [IDM's official site](https://www.internetdownloadmanager.com/)
is a public reference, not evidence of internal behavior or performance.

## Inferences and implementation

The compact toolbar/tree/table layout should make several downloads easier to
compare than ZipZap's former large cards. This is a usability hypothesis, not a
measured result. ZipZap independently implements that layout, keeping its own
name, logo, icons, translations and validated Tauri commands.

Filename selection enables the existing pause/resume/retry/cancel/open/reveal
and history-removal actions. Pause all calls the same pause command sequentially
for active/queued jobs and stops on the first error. Completed file removal
retains the existing engine guarantee that the destination stays on disk.
Categories are filename-extension filters, not MIME detection or automatic
destination rules. Sorting and search operate on the same live snapshots.

No matching Svelte table-selection guidance was returned by the optional UI/UX
skill search (including its narrower retry). Native table/button semantics,
visible focus, keyboard-scrollable overflow and existing dialog patterns were
used instead; automated accessibility checks verify the resulting states.

## Unknowns and boundaries

REA's MCP registration and native disassembler providers are unavailable on
this host. The working CLI resource inspection does not require either, and no
client configuration was changed. IDM's code, networking, segmentation,
resumption, scheduler and browser interception were not analyzed. No download
benchmark, feature parity, pixel-perfect reproduction or full understanding of
IDM is claimed. Proprietary icons, code and packaged assets are not reused.

## Verification

The UI suite exercises selection and command arguments, pause/resume/retry,
cancel/removal, failure retention, pause-all failure/retry, categories with
search/status filters, natural filename and size/status sorting, unknown sizes,
selection across snapshots, English/Arabic, keyboard controls and accessibility
at desktop/narrow widths. These tests mock the existing IPC boundary; they do
not establish native download integrity. The existing core fixtures cover that
separate contract. See [verification](../development/VERIFICATION.md).
