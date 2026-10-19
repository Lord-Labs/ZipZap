# Using ZipZap

ZipZap targets Windows 11 x64 and uses the installed Microsoft Edge WebView2
runtime. Choose an NTFS download folder with up to twice the file's size free
while assembly completes. Existing files are never overwritten.

## Desktop

Open **New download**, paste a direct HTTP/HTTPS link, optionally choose a plain
filename, select a folder, then start. Progress, speed and remaining time come
from the engine. Unknown lengths show an indeterminate progress bar. Select a file
and use the toolbar to pause, resume, cancel, or retry. Cancellation discards owned partial
files; removing a completed history entry keeps the downloaded file.

The development version uses a compact toolbar, category pane and download
table. Select a filename to enable its available toolbar actions. **Pause all**
pauses active and queued downloads, stopping if a command fails so you can
inspect the error and retry. The category pane filters by filename extension;
it does not move files or detect media. Search matches filenames and websites.
Click Filename, Total size or Status to sort; click again to reverse. Unknown
sizes stay last. Selecting a status filter clears the file-category filter.
These workspace changes are not included in the published first beta.

The development version shows the queue's saved running/held state. **Hold queue**
stops new starts while active downloads finish. Browser additions wait too;
explicit metadata checks can still inspect headers. **Start queue** enables
dispatch without resuming individually paused files. **Add for later** creates
a paused download; resume it explicitly when ready. Select a waiting download to
see its priority and use **Move up/down in queue** with keyboard or mouse. Moves
and hold survive restart; sorting the table does not change dispatch priority.
Resumed jobs keep their priority, and host limits can defer an earlier job.

In the development version, **Check filename** previews a safe server suggestion
without downloading the file. Starting with an empty name also previews first;
review or edit the name and press Start again. An explicit filename is kept.
If it is occupied, review and accept the proposed numbered alternative or type
another name. Suggestions do not reserve names, so a later race may still be
rejected safely. Closing the dialog cancels an outstanding metadata check; the
check also stops after ten seconds. If it fails, you can enter a plain filename
and retry. Unsupported/unsafe server names fall back to the link or download.bin.

The development version also keeps a rejected pause/resume/cancel action from
changing the download when its database save fails. If a worker cannot save its
final state, it shows Failed with a **last saved state retained** message. Repair
the storage problem, then retry; reopening uses the last saved checkpoint. For
new downloads, a file published just before a failed completion save can be
recognized on reopening or retrying from its saved digest and file identity. A
modified, replaced or unverifiable file shows **Published file conflict** and is
kept with its recovery data. Restore the original file/evidence or move the
conflicting file, then retry; ZipZap never replaces it. Legacy downloads without
saved publication proof still require manual verification. See
[recovery limits](development/ENGINE.md).

If the retained assembly itself is damaged or missing, preserve any output and
add a fresh download with a free filename. Retrying cannot rebuild missing
ownership evidence; removing failed history keeps the final file.

In the development version, opening first-beta saved state recovers the queue and
settings in one transaction. If recovery fails, the database and download files
are retained for repair and retry. A database from a newer unsupported version
is rejected without resetting it. Do not lower its schema number or delete it
to make an older app start; use the compatible app or restore a coherent backup
with all instances closed. A saved folder on an offline drive does not prevent
opening history. These changes are not in the published first beta; installer
upgrade qualification remains pending. The development database uses schema 4
for saved category folders (schema 3 added durable queue control; schema 2
introduced publication evidence). Older
ZipZap versions cannot open it; use a compatible app or a
coherent pre-upgrade backup, never edit the schema number to force a downgrade.

The add dialog shows that file size is initially unknown and recommends NTFS.
Download details estimate peak storage at up to twice the known size; this does
not reserve or guarantee capacity. If storage fills, becomes read-only or goes
offline, the development version shows repair instructions and keeps saved
checkpoints. Free space, allow writes or restore the folder, then retry. Valid
parts are reused; existing output files are kept. Physical full-volume behavior
has not been exercised on the current unelevated verification host.

The development version limits automatic retries to three attempts. Temporary
network/server failures and rate limiting may retry; authentication, TLS,
invalid requests and storage problems need your attention. Download details show
the localized reason, attempt and next retry time. A valid Retry-After from a
429/503 response is honored up to 30 seconds. Pause, cancel and closing the app
interrupt the wait; reopening leaves interrupted work paused, and Retry starts
a new bounded sequence. Certificate and file-validation checks remain enabled.

For a paused/failed download, choose **Replace link** and paste a new direct
HTTP/HTTPS link. Wait for its worker to stop first. ZipZap checks whether saved
parts belong to the same validated final resource. If it cannot prove this,
nothing changes until you explicitly confirm discarding partials and starting
from the beginning. Matching filenames or sizes are not proof; changed signed
links commonly need this restart. An updated download keeps its name/location
and stays paused; choose Resume when ready. Closing the dialog cancels the check.
If publication recovery is pending, repair/finish that recovery first. Keep
private links out of public screenshots and reports.

Settings control one to four simultaneous downloads, one to four connections per
download, a shared speed limit (0 means unlimited), the default folder and
language. The language button switches English/LTR and Arabic/RTL. Closing the
window pauses running work; queued work starts when the app next opens. Resume
paused work explicitly. Resume can safely restart when the server cannot prove
the resource has not changed. See [recovery limits](development/ENGINE.md).

The app never opens completed files automatically. Use **Open file** only when
you trust the file; **Show in folder** reveals it without executing it.

### Categories and suggested folders (development version)

In Settings, edit **Category rules** to rename a group, change its comma-separated
extensions or choose its save-folder suggestion. Add/remove groups up to 16;
keep Other for unknown/no-extension names. Matching ignores case and uses the
longest literal suffix, so tar.gz can override gz. An extension may belong to
only one category; resolve a reported duplicate before saving. Unicode letters
and numbers are supported; paths, wildcards and empty dot parts are rejected.

Built-in names follow the selected language until renamed. Custom names remain
as typed. **Restore default categories** resets the draft to the original six
groups and clears folder rules; Save commits it, and Close discards edits.
Rules and filters use saved settings across restart. Editing a category never
moves a completed file or a partial download.

New manual downloads use category folder suggestions after **Check filename**;
review a changed folder before starting. Choosing a folder explicitly turns off
automatic suggestions for that download; the checkbox can re-enable them.
Browser requests use the same category rules after checking the server filename.
Batch links keep their displayed common folder explicit. Existing/duplicate
destinations still require a free name. An offline category folder is retained
in Settings but new requests fail until it is restored or another folder is
chosen. These changes require schema 4; older builds reject that state rather
than ignore the saved folder choice. Native/browser/installer qualification for
the next release remains pending.

### Multiple files and links (development version)

Use each row's checkbox with Tab/Space, **Select all visible downloads**, or
Ctrl-click filenames to toggle selection. Shift-click selects a range in the
current table order. Filtering deselects hidden rows. For several selected files,
use **Pause selected**, **Resume / retry selected**, **Cancel selected downloads**
or **Remove selected history**. Each action applies only to eligible states and
reports every affected file, continuing after a failure. Retry applies only to
files still eligible. Cancellation discards partial data; history removal also
cleans recoverable partials while retaining completed output. Both bulk actions
first list the affected files for confirmation. Changing a file's state while
confirmation is open may make it ineligible; review that result rather than
assuming every captured file changed.

**Add multiple links** accepts one direct HTTP(S) link per line, up to 100.
An oversized batch is rejected, not truncated. Choose the common save folder and
start-now or add-for-later mode, then **Preview / recheck links**. Preview checks
headers without creating jobs, shows invalid/duplicate links, suggested names,
known sizes and filename conflicts. Edit a name and recheck to resolve conflicts;
only included, checked rows with unique names can be added. Hold queue still
governs start-now dispatch. Preview does not reserve a destination.

Enqueue results appear per row. Accepted rows are skipped on retry; failed
enqueue attempts retain their request IDs so a lost response can be retried
without creating a second job. After an enqueue attempt, its name, folder and
mode stay fixed for replay. Inspect the queue before creating a new batch with
changed details. Closing discards this transient preview; it is not a saved
import list. Closing during preview cancels its current metadata check. The
Close button and Escape remain disabled until enqueue responses finish. These workflows are not in
the published first beta; UI evidence uses mocked IPC, separate from native
release qualification.

## Chrome and Edge

The installer registers a native messaging host for the current Windows user.
The extension is distributed as source/a ZIP, not through browser stores yet.

1. Extract the extension ZIP into a permanent folder.
2. Open `chrome://extensions` or `edge://extensions` in your browser.
3. Enable Developer mode, choose **Load unpacked**, and select the extracted
   folder containing `manifest.json`.
4. Right-click a direct file link and choose **Download with ZipZap**, or open
   the extension popup and paste a link explicitly.

Requests use the app's default folder. The app starts if it is closed. If the
host is missing, open ZipZap settings and choose **Connect Chrome / Edge**. A
red extension badge/error shows a handoff problem; inspect its message and the
app's queue. The published first beta confirms only native receipt.

The development extension and host use a versioned receipt: **Received locally**
means the request is saved, **Added to the queue** confirms the app accepted it,
and rejection explains an occupied filename or asks you to inspect the app.
A held queue still accepts jobs but waits for you to start it. No handoff message
means the file has finished downloading. Missing/incompatible hosts require
repair/update and reconnection in Settings. Startup failure and a 15-second
confirmation timeout are distinct; after timeout the request may still be queued,
so check the app before sending again. Closing the popup stops its feedback;
it does not cancel a request already received. Context-menu feedback appears in
the extension badge/title. Feedback is available in English and Arabic.

The development version checks server filenames with the same rules as the
manual dialog. A duplicate browser destination is rejected; **Review filename**
offers the latest rejected link as a new editable download with an available
alternative. The original request was not queued. Resend the link if this
temporary review is dismissed or the app restarts. Metadata failures appear in
the app notice and return a sanitized rejection to the development extension.
Local results contain no links or filenames, expire after 24 hours and retain
at most 100 receipts. Replays reuse the same job while its receipt/history is
retained. Native acceptance is [reported by the maintainer](development/NATIVE_SMOKE.md);
release-candidate qualification remains with #47. These changes are not
part of the published first beta.

No cookies, browser history or tabs are read. Authenticated sessions, blob/data
URLs, protected players and HLS/DASH are unsupported. Signed direct links may
work until they expire, but are private: the local database stores their URLs.
Keep `%LOCALAPPDATA%\com.zipzap.desktop` private and out of bug reports.

Uninstall removes the native host registration and application binaries. It
retains download files and the local database/settings so a later reinstall can
recover them. Remove the unpacked extension separately through your browser.

## Keyboard and accessibility

Tab/Shift+Tab move focus; Enter/Space activate buttons; Escape closes a dialog.
Select a filename with Enter/Space to use the toolbar. Tab to the table region
and use arrow keys to scroll when columns do not fit. Dialogs keep focus inside
until closed. Buttons have accessible labels, progress
has names/values, and status changes use a polite live region. Paths and URLs
remain left-to-right inside Arabic layouts. System fonts and reduced-motion
preferences are respected. Automated checks supplement the Windows accessibility
tree checks; there is no claim of a full screen-reader certification.

## Distribution limits

The first beta is unsigned. No Authenticode publisher signature or SmartScreen
reputation is claimed. Verify the published SHA-256 checksums. There is no
automatic updater. Windows 10, other CPU architectures and other operating
systems have not been validated.
