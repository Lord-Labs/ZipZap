# Roadmap

This is the implementation order for the first Windows beta. The foundation,
strategy, production HTTP/HTTPS core, durable resume, and bounded queue are
implemented, including verified Windows desktop and browser integration.
[0.1.0-beta.1](https://github.com/Lord-shaban/ZipZap/releases/tag/v0.1.0-beta.1)
was published on 2026-10-17 with the M0–M5 gates verified; see the
[acceptance checklist and publication evidence](development/VERIFICATION.md).
GitHub issues own live acceptance criteria;
this document owns scope and sequencing.

[Project tracker](https://github.com/users/Lord-shaban/projects/12) ·
[Milestones](https://github.com/Lord-shaban/ZipZap/milestones) ·
[Product scope](PRODUCT.md)

## Milestones and exit gates

| Stage                      | Work                                                                                                                                                                   | Exit gate                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| M0 — Repository foundation | [#1](https://github.com/Lord-shaban/ZipZap/issues/1)                                                                                                                   | Policies, plan, issue tracker, required CI, and foundation PR merged                 |
| M1 — Download engine       | [#2](https://github.com/Lord-shaban/ZipZap/issues/2), [#3](https://github.com/Lord-shaban/ZipZap/issues/3), [#4](https://github.com/Lord-shaban/ZipZap/issues/4)       | Engine strategy recorded; direct and ranged output verified against fixtures         |
| M2 — Reliability and queue | [#5](https://github.com/Lord-shaban/ZipZap/issues/5), [#6](https://github.com/Lord-shaban/ZipZap/issues/6)                                                             | Recovery after restart, safe resume, queue transitions, and limits tested            |
| M3 — Desktop experience    | [#7](https://github.com/Lord-shaban/ZipZap/issues/7), [#8](https://github.com/Lord-shaban/ZipZap/issues/8)                                                             | Actual Windows UI downloads verified, including Arabic and accessibility             |
| M4 — Browser integration   | [#9](https://github.com/Lord-shaban/ZipZap/issues/9), [#10](https://github.com/Lord-shaban/ZipZap/issues/10)                                                           | Chrome and Edge handoff reaches a verified completed file                            |
| M5 — First public beta     | [#11](https://github.com/Lord-shaban/ZipZap/issues/11), [#12](https://github.com/Lord-shaban/ZipZap/issues/12), [#13](https://github.com/Lord-shaban/ZipZap/issues/13) | Integration evidence, security review, installer checks, and release notes published |

## Dependency order

```text
#1 foundation
  -> #2 engine strategy
  -> #3 direct download
  -> #4 validated ranges
  -> #5 persistent resume
  -> #6 queue and limits
  -> #7 desktop
       -> #8 Arabic and accessibility
       -> #9 native bridge -> #10 browser extension
  -> #11 end-to-end checks (requires #8 and #10)
  -> #12 security and distribution
  -> #13 beta release
```

Work may overlap only when dependencies and boundaries are clear. In particular,
desktop polish must not substitute for engine integrity, and browser integration
must use the same queue and validation as manual desktop requests.

## Engine strategy and next implementation

Issue #2 compares a small native Rust engine with reuse of aria2, including a
bounded HTTP fixture, integration costs, and dependency licensing. The
[recorded decision](architecture/0002-download-engine-strategy.md) selects
Rust/Tokio/reqwest with one owned transfer-state model. The probe is not production
code. Issues #3–#6 implement the streamed core, validated segmentation, durable resume,
and queue. See [core behavior and limits](development/ENGINE.md). Desktop work
starts in #7 and must call this same core.

## Tracking rules

- `Todo`: scoped, with known dependencies; blocked tasks stay here with a dependency note.
- `In Progress`: a contributor is actively working on the issue or its PR, including review.
- `Done`: acceptance criteria verified and the closing PR merged, or the release published
  when publication is itself the task. Closing an issue alone is not evidence.
- A milestone closes only when every required issue is complete and its exit gate
  is verified. Update the tracker when merging; there is no custom project bot.

Use `priority:p1` for first-beta work and `priority:p2` for follow-ups. Do not label
hard or security-sensitive work as `good first issue` merely to attract contributors.

## After the beta

Post-beta reliability work starts with [#23](https://github.com/Lord-shaban/ZipZap/issues/23):
preserve live history and recoverable files when database deletion fails, and
verify a successful retry after repair. That fix was merged in
[#24](https://github.com/Lord-shaban/ZipZap/pull/24). This does not change the published beta.

The [#25 desktop workspace](https://github.com/Lord-shaban/ZipZap/issues/25), based
on the [bounded IDM study](research/idm-desktop.md), was merged in
[#26](https://github.com/Lord-shaban/ZipZap/pull/26). It adds a compact toolbar,
file categories and sortable table with existing engine commands. The logo/name,
Arabic support and safe removal contract remain. It is not in the published beta.

## Next accepted development phase

The [M6 daily-use beta plan](planning/NEXT_PHASE.md) and its
[Arabic execution guide](planning/NEXT_PHASE.ar.md) define the comprehensive next
phase, prepared in [#27](https://github.com/Lord-shaban/ZipZap/issues/27).
[Epic #28](https://github.com/Lord-shaban/ZipZap/issues/28) owns the 19 required
children; [M6](https://github.com/Lord-shaban/ZipZap/milestone/7) groups the work.
The proposed candidate is `0.2.0-beta.1`, not a published version or a deadline.

| Order | Scope                                                                                | Issues           | Exit gate                                                                                                       |
| ----- | ------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| G0    | Native baseline, durable status, migration, publication and storage recovery         | #29–#33          | Real Windows baseline and deterministic failure/retry/reopen evidence preserve output and recoverable state.    |
| G1    | Retry reasons, safe names/link refresh, queue control and explicit tray lifecycle    | #34–#37, #41     | The shared core owns durable controls; private links, no-clobber output and bounded workers remain protected.   |
| G2    | Batch/categories/workspace, scheduling, browser feedback, provenance and diagnostics | #38–#40, #42–#45 | Complete English/Arabic daily workflows work through the same engine, with real platform checks where required. |
| G3    | Full-app measurements and candidate qualification                                    | #46–#47          | One reviewed candidate has upgrade, installer, native/browser integrity, security and release evidence.         |

Dependencies are explicit in each issue and recorded as native GitHub blocked-by
relationships. Start with [#29](https://github.com/Lord-shaban/ZipZap/issues/29)
and [#30](https://github.com/Lord-shaban/ZipZap/issues/30), then follow those
dependencies rather than issue number alone. All implementation tasks start Todo.

The failed-save consistency fix #30 was merged in
[#53](https://github.com/Lord-shaban/ZipZap/pull/53). The
[#29 native baseline](development/NATIVE_SMOKE.md) now records actual isolated
Windows/WebView2 evidence for the classic workspace. These development changes
are separate from the published first beta; remaining M6 dependencies stay open.

[M7](https://github.com/Lord-shaban/ZipZap/milestone/8) contains four separate
go/no-go studies: [browser capture/page links #48](https://github.com/Lord-shaban/ZipZap/issues/48),
[auth/proxies #49](https://github.com/Lord-shaban/ZipZap/issues/49),
[Firefox/store requirements #50](https://github.com/Lord-shaban/ZipZap/issues/50),
and [media formats #51](https://github.com/Lord-shaban/ZipZap/issues/51).
These are decisions, not accepted feature implementations or M6 release blockers.
The [feature study](research/next-phase-features.md) separates source observations,
official vendor claims, existing REA evidence and remaining unknowns.

One in-process queue is accepted for M6, including scheduling while the app runs.
Named/synchronization queues, FTP/torrents, cloud sync, website crawling, other
operating systems, OS wake/shutdown and an automatic updater remain deferred.
Scope changes need an explicit issue/plan update; planned checks are not results.
