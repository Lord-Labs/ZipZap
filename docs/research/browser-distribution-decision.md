# Firefox compatibility and browser distribution decision

Date: 2026-10-23. Decision-only issue: [#50](https://github.com/Lord-Labs/ZipZap/issues/50),
including its Chrome/Edge setup addendum. Source reviewed:
`72d943a56467a1ed740647f60ac0f15f66a33f33`. This is a distribution study,
not an approved listing, account registration or production Firefox port.

## Decisions

**Chrome/Edge: conditional go for a separately scoped package/identity change;
no-go for store submission now.** The unpacked route is a temporary developer
fallback, not an ordinary-user one-click installation. Accounts, real store IDs,
review approval and a qualified native-host compatibility matrix remain required.

**Firefox: no-go for shipping the present package/host.** An isolated Firefox
run rejected both the Chromium background manifest and the existing host's
identity contract. A future explicit-link-only compatibility issue can reuse
the framed inbox/Manager protocol after narrowly adapting the browser identity,
registration and manifest. Automatic capture/media parity is not accepted by
this result, and Firefox does not block first Chrome/Edge setup delivery.

**YouTube: no-go for submitting the current full-feature package as store-ready.**
The unreleased action exists independently under [ADR 0012](../architecture/0012-public-video-action.md).
Technical extraction and an owned clip do not establish distribution permission.
The current store candidate must wait for a reviewed permission/policy decision
or a genuinely narrower independently reviewed package. Hiding functionality
from reviewers or merely changing its description is not an acceptable route.

## Exact Firefox evidence

| Item                   | Identity and scope                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed artifact     | Firefox **158.0.1**, build **20261019185856**, Windows x64; `firefox.exe` 1,080,448 bytes, SHA-256 `76732d4e43c864194660c671c52ecf4bad89e43b666d9a0acf89cd4b692ced9b`.                                                                                                                                              |
| REA artifact inventory | Reused `inspect_pe_resources` Evidence `ev_7f163cb6a13e9c5cf55a4d4098f6c3a7305d14852767eb6279fa5161ca77522b`, provider `rea-pe-resources` v1, CLI record **6.7.0**. The current file hash was rechecked. This is static resource identity; opaque payloads/icon relationships establish no runtime compatibility.   |
| Runtime tools          | Node **24.19.0**, geckodriver **0.37.1**, SHA-256 `e95b4eac7960ffcd5acbfd92bb7d49d48f99c1d01a20ddd297fef8c80821020d`; headless temporary profile and disposable test add-on, not a personal profile.                                                                                                                |
| Existing local host    | Copied `zipzap-native.exe`, SHA-256 `2cdf2aab70b0e295ecb14fa93287d2b9bea9df41f49d3bc732cd3bb840a234aa`. The file hash identifies the tested artifact; its build-to-current-source provenance and release qualification are not asserted. Current source independently has the same Chromium-only identity boundary. |
| Retained result        | Private `closure-review/firefox-distribution/runs/445a9519-5958-4727-8a32-769779a5cb1d/results.json`; runner `probe-retry.mjs`, finished **2026-10-23 16:02:44 UTC**, exit **0**. These are ordinary WebDriver/process assertions, not REA runtime Evidence.                                                        |

The completed run used a unique research host name and one exact
`allowed_extensions` ID ending in `@example.invalid`; no wildcard or production
identity was added. It observed:

1. Temporary installation of a copy of the Chromium extension was rejected:
   `background.service_worker is currently disabled. Add background.scripts.`
2. A separate minimal disposable add-on with nativeMessaging sent one v2
   explicit-link request after a WebDriver button click. The unchanged host
   responded with `ok: false`, `Unexpected extension identity`.
3. Isolated inbox enumeration found no files. Direct process probes with Gecko's
   manifest-path/add-on-ID arguments and a wrong Chromium origin both received
   that same framed refusal. No Manager transfer or completed-file digest exists.
4. Ordinary Chrome/Edge/Mozilla native registration snapshots were unchanged.
   The owned disposable registry key was removed after the run.

The owned URL was a loopback placeholder; no fixture server/output is needed for
the observed pre-enqueue rejection. This rejects the existing contract rather
than proving a port's successful download path. Earlier attempts timed out,
could not navigate/select the extension tab, or expected a disconnect instead of
the host's existing framed refusal; they are retained failures, not passes.
The successful runner used Firefox's documented
[system-access testing flag](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html)
only to open the disposable extension page in its isolated browser. Production
Firefox settings, signature enforcement and host origin validation were unchanged.

## Platform and package matrix

| Target                   | Package/background                                                                                                                                | Identity and native registration                                                                                                                                                                           | Current evidence / distribution                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome **155.0.8059.86** | MV3 service worker; current build is an unpacked folder. Store preparation uses a reviewed ZIP.                                                   | Current development ID `binbcpkdchddgajmemjmhakpamjdkhpl`; exact `chrome-extension://ID/` in manifest and Rust validation; HKCU Google/Chrome NativeMessagingHosts.                                        | Actual isolated health/capture evidence in [ADR 0010](../architecture/0010-browser-readiness.md) and [capture record](../development/CAPTURE_PROTOCOL.md). No approved listing claimed. |
| Edge **155.0.4283.62**   | Chromium MV3; separate Edge submission/review.                                                                                                    | Edge catalog ID can differ from sideloaded/Chrome IDs; HKCU Microsoft/Edge NativeMessagingHosts. Exact matching must exist both in manifest and host code.                                                 | Same bounded prior evidence; store ID/approval unknown.                                                                                                                                 |
| Firefox **158.0.1**      | Current service-worker-only package rejected. A future Gecko build needs its supported event-page/background scripts and explicit Gecko metadata. | Stable `browser_specific_settings.gecko.id`; native manifest uses exact `allowed_extensions`, HKCU Mozilla NativeMessagingHosts. Firefox passes manifest path then add-on ID instead of a Chromium origin. | Actual refusal above; no working Manager/queue/digest or signed package.                                                                                                                |

Primary contracts: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Edge native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging),
[Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging),
[Gecko native manifests](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests),
and [Firefox background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts).
The app/installer owns native binaries and registration; installing an extension
does not install or repair the native app.

The current [build](../../scripts/build-extension.mjs) embeds a development public
key. [Chrome's key guidance](https://developer.chrome.com/docs/extensions/reference/manifest/key)
requires obtaining and comparing the actual dashboard identity; an existing
unpacked ID is not evidence of store identity. Edge explicitly warns that
published and sideloaded IDs may differ. Update both native manifest and Rust
validation together. Preserve only enumerated reviewed identities during any
migration; never accept arbitrary origins or allowlists supplied by callers.

## Accounts, signing, privacy and cost

| Route                            | Requirements and costs checked in official documentation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome Web Store                 | Google developer/publisher account, verified contact and two-step verification, ZIP, purpose/permission/data disclosures, listing assets and review. [Registration](https://developer.chrome.com/docs/webstore/register/) requires a one-time fee; [Chrome's April 2026 update](https://developer.chrome.com/docs/extensions/whats-new) identifies **US$5**. Confirm checkout/tax/region details before a separately authorized payment.                                                                                                                                                          |
| Edge Add-ons                     | Microsoft account as Partner Center primary owner, enrollment/account verification, ZIP, localized listing assets, single purpose, permission/remote-code/data/privacy declarations and certification notes/review. [Edge enrollment](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) has **no registration fee**; [submission requirements](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) do not imply approval or a fixed completion date.                                                                     |
| Firefox AMO or self-distribution | Mozilla/AMO developer account and stable Gecko ID. [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) is required for release/beta installations, including self-distributed unlisted builds; temporary development loading is not distribution. No signing charge was identified in the inspected process; account eligibility and actual submission remain untested. Reviewable source/build instructions must accompany transformed code under [add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/). |

Firefox's [built-in consent requirements](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
apply to new submissions from November 3, 2025. Classify data accurately in
`browser_specific_settings.gecko.data_collection_permissions` and select a
supported minimum Firefox version. Mozilla explicitly includes data sent through
native messaging in its [consent guidance](https://extensionworkshop.com/documentation/develop/best-practices-for-collecting-user-data-consents/).
Local handoff therefore does not justify declaring that no data is transmitted.

For every route, disclose full selected URLs sent to the local app, local job
history, bounded origin choices/recovery records, requested site inspection and
actual third-party requests. Capture is optional and site-scoped; video requests
may involve the original site, CDN and bundled extraction tools. No cookies,
telemetry or hosted ZipZap account is required by current scope. State native-app
dependency and unsupported private/session/one-use/DRM behavior. A broad
optional-host declaration still needs accurate justification. Existing packaging
does not itself satisfy store review or privacy disclosure.

[Chrome policy](https://developer.chrome.com/docs/webstore/program-policies/policies)
requires truthful scope, necessary permissions and limited browsing-data use;
its [agreement](https://developer.chrome.com/docs/webstore/program-policies/terms)
bars knowing third-party terms violations and unauthorized streaming downloads.
[YouTube's terms](https://www.youtube.com/static?template=terms) restrict downloading
and automated access absent the stated authorization. **Inference:** a generic
YouTube extraction promise cannot presently be represented as a qualified store
feature. Rights to a clip alone do not establish platform authorization. No
reviewer has approved or rejected this particular package; this is a no-go
decision on present evidence, not a prediction of a store verdict or legal advice.

## Installation, update, repair and removal

Until verified listing URLs exist, setup links to the existing
[Chrome/Edge instructions](../USER_GUIDE.md#chrome-and-edge), labels unpacked
installation as temporary/developer-oriented, and directs users to
`chrome://extensions` or `edge://extensions` to load the built folder. Do not
invent listing IDs/URLs or silently install/enable extensions.

The intended ordinary-user sequence is: install the app, explicitly open the
verified browser-specific listing, install/enable there, then **Check connection**
in that same profile. Registration success alone is not extension presence;
recent contact and live app readiness remain separate under ADR 0010.

If missing/disabled, direct the user to that profile's extension settings. If the
host is unreachable, use the existing Connect Chrome/Edge repair and repeat the
connection check. A version/identity mismatch needs explicit compatible updates,
never trial enqueue. If policy blocks developer mode or an extension, explain
that manual desktop downloads remain available. Keep the English/Arabic
instructions equivalent.

Store updates retain their store identity and are distributed through that
store; unpacked updates require replacing/reloading the developer folder.
Native host updates remain part of app installation. Removing an extension must
stop new capture without deleting accepted jobs/files. App uninstall removes
only its owned registration; it does not silently remove a browser extension.
A surviving extension should show host-missing recovery. Firefox temporary
add-ons disappear on restart and cannot be described as durable installation;
a future signed/self-distributed update route needs separate qualification.
These are required expectations, not new tested installer/store results.

## Smallest follow-up scopes and acceptance mapping

A **store-package/identity issue**, after this conditional go is reviewed, must
produce reproducible Chrome/Edge ZIPs, reviewed feature/privacy disclosures,
real ID inputs obtained through separately authorized accounts, exact host
allowlists plus code validation, setup URLs only for approved listings, and
upgrade/repair/uninstall tests. Test old extension/new host, new extension/old
host and new/new: supported explicit versions work once; unsupported identity or
capability refuses clearly without a queued job. Consent, late acknowledgment,
native queue/digest and persisted jobs must survive update/repair. No new
runtime dependency or identity framework is justified.

A separate **Firefox explicit-handoff issue** may be scoped after product go:
browser-specific manifest/identity, strict Gecko argv validation, owned HKCU
registration/removal, truthful readiness labels, localized feedback and
successful/refused/old-version/restart queue/digest evidence. Do not add capture,
media or automatic browser installation incidentally. No issue submission,
account creation, payment or store upload was performed by this study.

| #50 criterion                                                                    | Disposition                                                                                                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Firefox manifest/native/signing/store requirements; distinguish approval | Primary contracts and account table above; feasibility separated from unperformed signing/review.                                                     |
| Isolated Firefox exact test identity proves or rejects existing contract         | Completed refusal run above; current package/host rejected, no queue/digest success claimed.                                                          |
| Package/identity/install/update/removal/privacy/accounts/cost                    | Matrix and lifecycle/disclosure requirements above; actual production/store combinations remain unqualified.                                          |
| Compatibility matrix and go/no-go follow-ups                                     | Conditional Chrome/Edge package go; no submission; current Firefox package no-go; narrow follow-up scopes only.                                       |
| Chrome/Edge independent of Firefox, setup links/recovery and stable IDs          | Explicitly separated; unpacked fallback remains truthful; no invented catalog ID.                                                                     |
| Actual #48/#51 permissions/media and explicit YouTube decision                   | Disclosure review covers optional capture/player inspection and native extraction. YouTube store submission no-go pending permission/policy decision. |

Official sources were checked on 2026-10-23. No account, payment, live listing,
store update, signed XPI or successful Firefox download was tested. Native
signing/Windows publisher trust are separate from browser-store signing. Hosted
checks were skipped under #54. #88/#89/#82 and #46/#47 retain their independent
installed-candidate and release acceptance gaps.
