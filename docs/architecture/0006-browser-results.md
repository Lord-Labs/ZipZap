# ADR 0006: Report browser enqueue outcomes through local result files

- Status: accepted for issue #43; native qualification remains required.
- Date: 2026-10-19.

Keep the explicit native messaging handoff and single Manager. Version 2 sends
an extension-generated canonical UUID with `enqueue` or `status`. Enqueue first
fsyncs and renames the existing inbox request, then the host starts/focuses the
desktop. Receipt means only durable local storage. The extension polls status
for at most 15 seconds and shows receipt separately from `queued` or `rejected`.
Queued includes a held queue and never means download completion. Timeout leaves
the request pending and warns that it may still be queued; it does not resend.

The desktop writes a small atomic result before removing the inbox file. A saved
job with the same UUID wins on replay, including a crash between job persistence
and result publication. Results contain only version, UUID, state and an allowlisted
error code, never URLs, filenames, filesystem paths or raw errors. Results expire
after 24 hours; retain at most 100, evicting oldest results. Replay idempotency is
bounded by retained results and job history. Status lookup never creates work or
starts an application. Inbox/frame/origin/URL/queue validation remains mandatory.

Version 1 requests remain supported with their receipt-only response. A new
extension reports an incompatible host and asks the user to update; it does not
silently resend through version 1. No new permission, listener, service or
dependency is needed. Actual Chrome/Edge and app startup evidence must be
recorded separately from protocol/unit tests.
