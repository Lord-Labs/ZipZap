# ADR 0010: Report bounded local browser readiness

- Date: 2026-10-23.
- Scope: #87; v1/v2 explicit handoff remains unchanged.

Add a v2 `health` action with a canonical UUID and allowlisted browser label
(`chrome` or `edge`). Exact origin, frame size and schema validation still apply.
No URL is accepted. A health request never creates a job or requests desktop
launch; it reports the host version, explicit-handoff capability and whether a
desktop heartbeat is less than five seconds old. Only an opened Manager's desktop
loop publishes that heartbeat, at most every two seconds. Missing, stale, future
or invalid records cannot establish readiness. Long blocking operations may
temporarily make readiness unknown; a heartbeat is not a liveness guarantee.

Health stores one bounded last-contact record per browser, containing a time and
the request's ephemeral UUID. There is no persistent profile/account identifier
or contact history. Desktop reports recent contact for five minutes, never that
every profile has the extension or that absent contact proves it is uninstalled.
The label is supplied by the extension and is only a UI hint, not authorization.
Two contact records and one heartbeat contain no browsing data. Unknown fields,
invalid UUIDs/browser labels and URL-bearing health requests are rejected.

Registration remains a separate fact. In the extension the user explicitly
chooses Check connection; host reachability and recent desktop readiness are
separate results. A health timeout has no ambiguous download side effect.
Older hosts show update guidance without falling back to enqueue.

No new dependency, permission, network listener or service is introduced.
The Windows isolated health harness uses a random test native-host name and
temporary profiles/state, leaving normal host registration untouched. A synthetic
heartbeat checks response fidelity; it does not qualify a real desktop database.

## Local verification, 2026-10-23

The isolated harness passed with installed Chrome 155.0.8059.86 and Edge
155.0.4283.62. Both established native contact without an inbox/results directory,
then correctly recognized a synthetic heartbeat. Native unit tests separately
cover stale/future/invalid state and no-launch/schema behavior. Eight browser UI
tests cover the explicit and health paths, including EN/AR and old-host guidance;
the complete 47 UI/Axe tests passed. The first harness attempt was blocked by
Playwright's default disable-extensions argument; removing that argument fixed
the test launch. This was a harness setup failure, not a qualified product result.

This evidence does not close #82's installed-download runner stall or #46/#47
startup/release qualification. Hosted workflows were skipped under #54.
