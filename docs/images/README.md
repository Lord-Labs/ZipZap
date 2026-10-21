# Desktop screenshots

`desktop-ar-0.2.jpg` and `desktop-en-0.2.jpg` show the actual 0.2.0-beta.1
Windows WebView2 interface in Arabic and English, captured on 2026-10-21.
The native debug host uses the production bundled frontend and isolated app
identity/state; it is not the installed release executable or performance evidence.
Application source is from `391b133` (the product sources match the released
candidate inputs; subsequent release preparation changes verification/docs).

Three loopback downloads were created through the real shared-core headless
interface and their output hashes verified; a fourth job was added paused.
The filenames are local test fixtures. In particular, “Browser handoff fixture.bin”
is a filename, not a claim that screenshot preparation exercised browser handoff.
The images show no private URLs, user paths or download history. No UI was mocked
or composited into them. These same images are used on the landing page.

The older `desktop-ar.png` is retained as historical artwork. Only the two new
captures are used for the current release preview; additional device control was
excluded at the maintainer's request.
