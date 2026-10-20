# Daily-use performance baseline: issue #46

This work measures the current production core and bundled frontend before any
optimization. It does not change the engine, connection caps, polling, UI or
published beta. The [historical benchmark](benchmark.md) remains a different,
32 MiB engine-only workload. Full native acceptance is pending.

## Repeat the controlled measurements

On Windows with the repository's pinned tools and Playwright Chromium installed:

```powershell
cargo build -p zipzap-core --release --locked
npm run build:web
node scripts/benchmark-performance.mjs .research-local/performance-46-new-run
```

Choose a new directory every time. The harness refuses an existing directory.
It keeps all output, synthetic databases, fixture certificate/private key and
binaries outside Git. Only sanitized measurements belong in a PR. The root
certificate is passed explicitly to the test core; the Windows trust store is
unchanged. A second core without that CA must reject the same TLS endpoint.

The 8 MiB deterministic fixture uses 64 KiB chunks and three repetitions with
one/four configured connections; order alternates per repetition. Conditions:

| Condition        | Owned loopback server behavior                                                       |
| ---------------- | ------------------------------------------------------------------------------------ |
| Paced            | 5 ms before response headers; 2 ms between chunks per response                       |
| Latency          | 80 ms before response headers; the same chunk pacing                                 |
| Unequal segments | Last quarter of the representation uses 12 ms between chunks; earlier bytes use 2 ms |
| Range refusal    | Returns a full 200 response to a range request; only the probe may carry Range       |
| Rate limit       | First request receives 429 with Retry-After: 1; the normal engine retries            |
| TLS              | Same paced fixture with explicit local CA trust and normal certificate verification  |

Wall time covers enqueue, dispatch, retries, transfer and publication, measured
with a monotonic clock before hashing. Every completed output is SHA-256 checked.
The server observes transfer-response concurrency separately from metadata probes
and honors stream backpressure. Assertions cover completion, exact hashes, range
fallback, retry and rejection of the untrusted TLS certificate. Windows process
CPU/peak working set cover the core lifetime, excluding server, harness and GUI.
They are sampled after completion, outside the timed transfer.

The same harness creates 100/1000 paused, zero-byte synthetic jobs through normal
core add-for-later calls. They use reserved example.invalid URLs and unique local
filenames. No personal history, active downloads or completed-file state is used.
Each measurement reopens that database in a release core process. Production
Svelte assets run in fresh headless Chromium contexts at 1200×800, in English and
Arabic, three repetitions each. The test bridge calls the real core's jobs,
queue and settings commands; it is not Tauri IPC or WebView2. Ordinary 750 ms
polling stays enabled. It verifies row counts, one-result search, ascending and
descending sort through a real settings save, selection and error-free execution.

Raw metrics retain each repetition and operation. Core startup ends at the first
settings response. Browser load ends at the observed expected row count. Search
and snapshot frame timings include two requestAnimationFrame callbacks, a paint
opportunity estimate rather than GPU presentation proof. Sort includes Playwright
input dispatch, the core save, refresh and observed row order. JSON byte counts
describe the bridge payload, not Tauri wire overhead. Renderer TaskDuration over
three seconds includes normal snapshot refreshes with one row selected; JS heap
is a point sample, not renderer RSS or total WebView memory.

The server/client share one host; response delay is not WAN RTT or packet loss.
OS/disk caches are warm; no cache flush occurs. A fresh browser context is not a
cold system boot. Three runs describe this host, not a population, and no IDM
comparison or universal speed claim is made. Keep builds and other heavy work
outside timed runs.

## Native Windows collection still required

The current prohibition on agent control of the maintainer's active desktop is
preserved. A human can run the collector in an appropriate Windows test session:

```powershell
./scripts/prepare-desktop-smoke.ps1 -Release
./scripts/measure-native-performance.ps1 -RunFile <printed-run.json> -HistoryDirectory <benchmark-directory>
```

Prepare a new identity after collecting the matching engine/UI baseline, at the
same source commit. The collector rejects normal/debug identities, unexpected
executable/state paths, changed hashes, sidecars, existing state and mismatched
commits before launching. It copies only the generated synthetic history into
that fresh isolated state. The profile has no browser sidecar, so it cannot
replace normal browser registration. Never connect a browser or start/resume
the synthetic example.invalid jobs. This seeded performance dataset is separate
from the genuine native download acceptance in
[NATIVE_SMOKE.md](../development/NATIVE_SMOKE.md).

For each row count, manually inspect three launches: press Enter when the table
is visible, then search fixture-0000.bin, clear, sort and scroll, including both
languages. The collector samples the owned app/core and descendant WebView2
processes once per second for 20 seconds, then requests observations and a manual
close. It records process CPU totals, private bytes and working sets, actual
WebView2/host versions, window-handle readiness and human table-readiness timing.
The human timing includes reaction time; handle readiness is not painted readiness.
Shared working-set pages may be counted more than once. Sampling may miss peaks
and process churn; do not treat it as unique physical RAM or compare it with the
engine-only sample as if they had the same scope.

Use `-ColdBoot` only for the first app launch after a real boot in a disposable
test session. It labels the operator's report; it does not flush caches or reboot.
Three independent cold runs need three separate boot sessions/new identities;
all other runs are warm reopens or fresh-profile/unknown-cache observations.
Do not reboot the active work host to obtain evidence. Local native-results.json
is written after each run; inspect its free-text observations for private details
before sharing. The collector has parser/guard checks but no agent-run positive
native trial. Native startup/resource distributions and budgets remain pending
until those results exist. Do not close #46 or qualify #47 from headless data.

## Decisions

No adaptive segmentation or connection-cap change is implemented by this issue.
The comparison measures the existing one/four-connection choices, not a proposed
adaptive algorithm. A go decision would require a separate bounded issue, a
repeatable benefit over the existing strategy under the same fixture and host,
and preserved validators, range fallback, hashes, resume and cancellation.
Large-list optimization likewise needs observed interaction/refresh cost and a
scoped follow-up. No speculative virtualization or polling rewrite is included.
