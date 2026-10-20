# Daily-use performance baseline: issue #46

This work measures the current production core and bundled frontend before any
optimization. It does not change the engine, connection caps, polling, UI or
published beta. The [historical benchmark](benchmark.md) remains a different,
32 MiB engine-only workload. Full native acceptance is pending.

## Observed baseline: 2026-10-20

[Raw repetitions](performance-windows.json) were recorded from clean harness
commit `bd983e3125065fa2b6175c8eccb42af035efb483`, based on main `d98cfc0`.
Production sources are unchanged from that main: core tree
`7f41e0a5043a307632bc42190536ec76027a7eac`, desktop tree
`6f243a29a9453f40e33644c9207caefedd4b6d96`. Windows 11 build 26200 x64,
Intel Core i5-13450HX (16 logical CPUs), 16 GB RAM, Node 24.19.0, Rust 1.99.0
and headless Chromium 149.0.7827.55. No build ran during the timed measurements;
other host activity is not controlled. Disk type/cache flushing was not measured.
The release engine's SHA-256 and host specs are in the raw file.

All 36 completed outputs matched the deterministic 8 MiB SHA-256
`52785dcc575cd392f0e3c7bd72585332f2283ba9dea6859ad08ba6a93ee97706`.
TLS verification also rejected the untrusted fixture. Each transfer cell below
is median elapsed milliseconds, with observed min–max in parentheses, n=3:

| Condition        | 1 connection     | 4 connections    |
| ---------------- | ---------------- | ---------------- |
| Paced            | 1473 (1469–1572) | 515 (455–550)    |
| Latency          | 1630 (1595–1647) | 706 (696–719)    |
| Unequal segments | 1586 (1503–1761) | 751 (734–819)    |
| Range refusal    | 1372 (1347–1449) | 1349 (1316–1395) |
| Rate limit       | 2414 (2347–2455) | 1523 (1498–1557) |
| TLS              | 1478 (1400–1574) | 602 (530–604)    |

UI cells are median / nearest-rank p95 (observed min–max), pooling English and
Arabic equally. Startup/render/resource values have six repetitions per size;
search has 30 operations, sort 12. Snapshot frame samples number 46/63 and mix
initial load, normal refreshes and refreshes during interaction. The raw file
retains languages, repetitions and individual operations. These small-sample
percentiles are descriptive; p95 equals max when n=6 or n=12.

| Metric                                    | 100 paused rows             | 1000 paused rows            |
| ----------------------------------------- | --------------------------- | --------------------------- |
| Core process startup, ms                  | 48 / 63 (36–63)             | 63 / 88 (45–88)             |
| Browser initial row observation, ms       | 216 / 409 (160–409)         | 555 / 732 (451–732)         |
| Search to two frames, ms                  | 24 / 30 (10–31)             | 29 / 65 (23–119)            |
| Sort through core save, ms                | 130 / 157 (75–157)          | 594 / 1024 (426–1024)       |
| Snapshot request to two frames, ms        | 49 / 136 (25–162)           | 284 / 553 (174–691)         |
| Core bridge portion of snapshot, ms       | 2.3 / 5.2 (1.3–7.3)         | 16.4 / 27.4 (10.0–30.9)     |
| Maximum snapshot JSON bytes               | 43,553                      | 424,253                     |
| Core process peak working set, MiB        | 9.17 / 9.18 (9.14–9.18)     | 15.16 / 15.18 (15.10–15.18) |
| Browser JS heap sample, MiB               | 10.8 / 13.6 (6.3–13.6)      | 46.0 / 50.2 (34.7–50.2)     |
| Core CPU seconds, entire interaction case | 0.031 / 0.047 (0.016–0.047) | 0.266 / 0.344 (0.219–0.344) |
| Renderer task-duration delta during 3 s   | 0.095 / 0.104 (0.081–0.104) | 0.620 / 0.696 (0.555–0.696) |

Renderer task duration and heap come from
[CDP Performance metrics](https://chromedevtools.github.io/devtools-protocol/tot/Performance/).
Task duration is a renderer work counter, not a whole-machine CPU percentage;
native process CPU and total WebView memory still need separate collection.
Heap is a GC-dependent point sample, not a maximum. Core CPU covers the full case,
including operations and polling, not only the three-second renderer window.

## Baseline budgets before optimization

Use the following investigation thresholds when repeating this exact host/build/
dataset/method. They round above observed baseline values to allow variation;
they are neither user-facing SLAs nor timing assertions in correctness tests.
A repeated overrun needs raw evidence and a scoped decision, not an automatic
connection-cap, integrity-check or polling change. Preserve all output hashes and
failure/recovery checks independently of timing. Different hardware needs its
own recorded baseline before comparison.

| Metric                                   | 100 rows   | 1000 rows    |
| ---------------------------------------- | ---------- | ------------ |
| Core startup max                         | 100 ms     | 125 ms       |
| Browser initial rows max                 | 750 ms     | 1000 ms      |
| Search p95 / max                         | 50 / 75 ms | 100 / 150 ms |
| Sort p95                                 | 250 ms     | 1250 ms      |
| Snapshot to two frames p95               | 200 ms     | 750 ms       |
| Snapshot JSON max                        | 64 KiB     | 512 KiB      |
| Core peak working set max                | 16 MiB     | 24 MiB       |
| JS heap sample max                       | 24 MiB     | 96 MiB       |
| Core CPU per full case max               | 0.10 s     | 0.50 s       |
| Renderer task-duration delta per 3 s max | 0.20 s     | 1.00 s       |

The 1000-row refresh cost is material compared with the 750 ms polling interval;
sort exceeded one second once. The bridge portion is much smaller than the
end-to-end frame timing. This motivates native corroboration/profiling, not a
claim that serialization, a particular source loop or rendering caused all the
cost. Total native app/WebView memory, CPU and cold/warm startup budgets remain
unset until actual native repetitions are recorded.

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
Ownership includes the unique profile if a warm WebView browser outlives its
original parent. A missing WebView process makes the measurement fail instead
of silently reporting zero memory. Command lines are used only for that local
ownership check and are not written to the results.
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

Run `./scripts/test-native-performance.ps1` to exercise the eight collector
refusal paths with non-executable fixture files. It never launches a window.

## Decisions

**Adaptive segmentation/connection tuning: no-go for implementation now.**
Existing four-way ranges helped the deliberately paced, latency and unequal-tail
fixtures, while range refusal gave similar times with either setting. Rate-limit
waits remained intact. These observations support retaining the current bounded
strategy; they do not measure an adaptive alternative or justify higher caps.
A future go decision needs a separate bounded issue, repeatable benefit over
the existing strategy and preserved validators, fallback, hashes, resume and
cancellation. No engine code is changed here.

**Large-list virtualization/polling rewrite: no-go for implementation now.**
Search p95 stayed below 65 ms at the 1000-job limit, while sort/refresh cost
increased substantially. Native corroboration and a profile must identify the
cause before selecting a smaller refresh change or virtualization. Do not
increase the history limit or stop ordinary refreshes to conceal the workload.
No list optimization is implemented or claimed. Revisit this decision after the
pending native measurements; #46 remains open until its full-app gate is met.
