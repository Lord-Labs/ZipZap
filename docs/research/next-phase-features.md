# Next-phase feature and readiness study

Date: 2026-10-17. Planning issue: [#27](https://github.com/Lord-shaban/ZipZap/issues/27).
Baseline: `5905271` on main; published application: `0.1.0-beta.1`.
This is a planning study. New features and future verification listed here have
not been implemented or executed by this task.

## Evidence boundaries

The [existing IDM study](idm-desktop.md) identifies installed IDM 6.43.15.2,
its artifact hash and REA resource-inventory Evidence
`ev_e87a40d1c86278f7e90ee77d18a4a707b9bc112dc8951623c56df8791c79427e`.
That evidence is reused, not regenerated. Separate main-window observations
establish its visible toolbar/category/table arrangement. Neither source
establishes IDM's network algorithms, recovery correctness or performance.

The official pages below were checked on 2026-10-17. Their feature descriptions
are **vendor documentation**, not independently observed runtime behavior.
Source inspection of ZipZap uses ordinary repository tools, not REA. There is
no new native decompilation, packet capture, benchmark or user study here.

## Documented reference workflows

| Workflow                                                         | Reference evidence                                                                                               | Implication for ZipZap                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| File selection, columns, context actions and editable categories | [IDM main-window documentation](https://www.internetdownloadmanager.com/support/main.html)                       | Finish usable classic controls; keep ZipZap branding and independent icons.                                        |
| Queue order and scheduled start/stop                             | [IDM scheduler documentation](https://help.internetdownloadmanager.com/support/idm-scheduler/idm_scheduler.html) | Implement one durable queue gate first, then bounded scheduling; named/synchronization queues stay deferred.       |
| Refreshing an expired file address                               | [IDM resume FAQ](https://http.internetdownloadmanager.com/register/new_faq/sites2_3.html)                        | Offer explicit link replacement with a conservative representation-identity rule.                                  |
| Adaptive range assignment                                        | [IDM segmentation description](https://www.internetdownloadmanager.com/support/segmentation.html)                | Measure ZipZap's uneven-stream workload before deciding on adaptive segmentation.                                  |
| Browser capture, page links, themes, proxies and authentication  | [IDM feature descriptions](https://www.internetdownloadmanager.com/features2.html)                               | Themes are accepted UI work; browser capture/authentication require separate feasibility and permission decisions. |

No speed multiplier or internal implementation is adopted from these sources.
The existing [ZipZap benchmark](benchmark.md) covers only its stated paced
loopback engine workload, not GUI startup, a WAN or an IDM comparison.

## Observed ZipZap capabilities and gaps

| Area                    | Source observations at the baseline                                                                                                                                                                | Planned response                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable status          | [Manager::action/update/worker](../../crates/zipzap-core/src/lib.rs) mutate some live states before saving, and final worker update errors are discarded. `remove` already commits deletion first. | Reproduce the remaining failure paths, then preserve agreement between live and durable state. This is a source finding, not a new fault-injection result. |
| Upgrades                | `Manager::open` supports schema version 1, defaults some settings, and rejects newer versions.                                                                                                     | Test beta-to-next-schema upgrade/failure/reopen before adding persisted fields; no generic schema framework.                                               |
| Completion recovery     | [Engine limits](../development/ENGINE.md) record a crash interval between final hard-link publication and completion commit.                                                                       | Reconcile only provably owned output; never adopt by name or size alone.                                                                                   |
| Disk and paths          | Hard-link support and potentially 2x temporary space are required; unavailable-folder recovery is tested.                                                                                          | Add explicit storage errors, space estimates and bounded failure evidence. Real disk exhaustion is currently unknown.                                      |
| Retry policy            | The worker makes three bounded attempts with exponential sleeps; failures are strings.                                                                                                             | Classify reasons, respect bounded server retry delays and expose useful recovery advice.                                                                   |
| Names                   | `Manager::add` derives a plain URL-path name or `download.bin`; destinations are validated/no-clobber.                                                                                             | Safely suggest server names and review duplicates while retaining final race protection.                                                                   |
| Resume/link replacement | [Transfer validation](../../crates/zipzap-core/src/transfer.rs) checks ranges, validators, effective URLs and prefix hashes.                                                                       | Preserve those guarantees when explicitly replacing an expired URL; restart when identity cannot be proved.                                                |
| Queue                   | One queue, row/vector dispatch order, bounded concurrency and immediate-resume worker guard exist.                                                                                                 | Persist ordering and start/hold state before scheduling or batch add-for-later.                                                                            |
| Desktop                 | [App.svelte](../../apps/desktop/src/App.svelte) provides single selection, fixed extension filters, sorting/search and dark styling.                                                               | Add bulk workflows, custom category suggestions, keyboard context actions, saved columns and light/system themes.                                          |
| Lifecycle               | [Tauri shell](../../apps/desktop/src-tauri/src/app.rs) pauses/shuts down on close; no tray workflow exists.                                                                                        | Add explicit close-to-tray choice and optional bounded notifications; no service or hidden startup registration.                                           |
| Browser                 | [Extension manifest](../../extensions/browser/manifest.json) requests only context menus/native messaging; the host acknowledges receipt.                                                          | Improve queued/rejected feedback without automatic interception or broader production permissions.                                                         |
| Windows provenance      | [Security review](../development/SECURITY_REVIEW.md) covers file/URL ownership; it does not establish attachment zone metadata.                                                                    | Evaluate and verify Windows attachment/provenance policy without executing files or bypassing OS warnings.                                                 |
| Diagnostics             | Current errors and UI hostnames do not amount to a reviewed support export.                                                                                                                        | Add user-initiated preview/redacted export with adversarial redaction checks; no telemetry.                                                                |
| Distribution            | The published beta predates the classic workspace. [Nine UI tests](../development/VERIFICATION.md) for the new workspace mock IPC.                                                                 | Begin with real native evidence; finish M6 with upgrade/installer/browser qualification at one candidate commit.                                           |

## Platform checks that constrain the plan

- [Tauri system tray](https://v2.tauri.app/learn/system-tray/) provides a platform
  capability; it is not proof of ZipZap lifecycle correctness. Tray work must
  reuse the single Manager and prove checkpointed quit behavior.
- [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
  is a candidate for capture research. Whether ownership can be transferred
  safely under exact browser versions still needs isolated fixtures.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
  gives temporary user-invoked access; it does not justify permanent all-site
  permission for a page-link collector. Those are separate decisions.
- [Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
  has platform/extension-identity requirements that need their own packaging
  study. An unpacked Chromium success is not Firefox or store evidence.
- [Windows IAttachmentExecute](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-iattachmentexecute)
  is a candidate attachment-service interface, not an already selected or
  implemented ZipZap policy. Payload integrity, provenance and API failures
  need explicit verification.
- [Tauri updater](https://v2.tauri.app/plugin/updater/) requires update-signing
  arrangements. Update signatures and Windows publisher signing are different
  controls; an automatic updater is deferred until both the artifact trust and
  failure/rollback policy are separately qualified.

## Inferences, decisions and unknowns

**Inference:** protecting existing data, explaining failures and completing daily
queue/desktop workflows should improve usefulness more directly than adding
many protocols at once. This is a prioritization judgment, not measured user
feedback. M6 accepts that scope; [the phase plan](../planning/NEXT_PHASE.md)
contains the ordered issues and gates.

**Unknown:** real current-workspace/native regression results, storage exhaustion,
full-app performance budgets, auth/proxy defaults in the actual runtime,
browser-capture ownership behavior, Firefox/store prerequisites and media-format
cost. The corresponding issues own evidence rather than asserting answers now.

**Deferred:** named/synchronization queues, quotas, FTP/torrents, website crawling,
cloud accounts, cross-platform support, unattended OS wake/shutdown, automatic
updates and arbitrary post-download programs. Direct HTTP(S) media already works;
web-player/HLS/DASH extraction remains a separate go/no-go study. No production
permission expansion or new dependency is authorized merely by this study.
