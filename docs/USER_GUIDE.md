# Using ZipZap

ZipZap targets Windows 11 x64 and uses the installed Microsoft Edge WebView2
runtime. Choose an NTFS download folder with up to twice the file's size free
while assembly completes. Existing files are never overwritten.

## Desktop

Open **New download**, paste a direct HTTP/HTTPS link, optionally choose a plain
filename, select a folder, then start. Progress, speed and remaining time come
from the engine. Unknown lengths show an indeterminate progress bar. Use the row
buttons to pause, resume, cancel, or retry. Cancellation discards owned partial
files; removing a completed history entry keeps the downloaded file.

Settings control one to four simultaneous downloads, one to four connections per
download, a shared speed limit (0 means unlimited), the default folder and
language. The language button switches English/LTR and Arabic/RTL. Closing the
window pauses running work; queued work starts when the app next opens. Resume
paused work explicitly. Resume can safely restart when the server cannot prove
the resource has not changed. See [recovery limits](development/ENGINE.md).

The app never opens completed files automatically. Use **Open file** only when
you trust the file; **Show in folder** reveals it without executing it.

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
red extension badge/error means the request was not accepted by the host. An
accepted handoff can still fail in the app (for example, duplicate filename or
unavailable destination); inspect the app's error notice and queue.

No cookies, browser history or tabs are read. Authenticated sessions, blob/data
URLs, protected players and HLS/DASH are unsupported. Signed direct links may
work until they expire, but are private: the local database stores their URLs.
Keep `%LOCALAPPDATA%\com.zipzap.desktop` private and out of bug reports.

Uninstall removes the native host registration and application binaries. It
retains download files and the local database/settings so a later reinstall can
recover them. Remove the unpacked extension separately through your browser.

## Keyboard and accessibility

Tab/Shift+Tab move focus; Enter/Space activate buttons; Escape closes a dialog.
Dialogs keep focus inside until closed. Buttons have accessible labels, progress
has names/values, and status changes use a polite live region. Paths and URLs
remain left-to-right inside Arabic layouts. System fonts and reduced-motion
preferences are respected. Automated checks supplement the Windows accessibility
tree checks; there is no claim of a full screen-reader certification.

## Distribution limits

The first beta is unsigned. No Authenticode publisher signature or SmartScreen
reputation is claimed. Verify the published SHA-256 checksums. There is no
automatic updater. Windows 10, other CPU architectures and other operating
systems have not been validated.
