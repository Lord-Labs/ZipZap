# Windows engine benchmark

Measured 2026-10-16 on Windows 11 Pro build 26200 x64, Intel Core i5-13450HX
(16 logical CPUs), 16 GB RAM and a local NTFS SSD. Rust 1.99.0, Node 24.19.0.
The [raw measurements](benchmark-windows.json) identify the production core Git
tree. The release engine used thin LTO, one codegen unit and stripped symbols.

```sh
cargo build -p zipzap-core --release --locked
node scripts/benchmark.mjs docs/research/benchmark-windows.json
```

The deterministic 32 MiB HTTP loopback fixture sends 64 KiB chunks with a 2 ms
delay per response/chunk, exact ranges and a strong ETag. Three repetitions each
use one and four connections, one job, unlimited configured bandwidth. Every
output is checked against SHA-256
`e03376c016449d6befb94816ef1480dbeec5275bd7f882407e49469f3cbfd5f0`.

| Connections | Median throughput | Observed range    | Engine peak working set | Engine CPU time per run |
| ----------- | ----------------- | ----------------- | ----------------------- | ----------------------- |
| 1           | 18.53 MiB/s       | 18.44–19.36 MiB/s | 9.91–11.32 MiB          | 0.58–0.69 s             |
| 4           | 49.38 MiB/s       | 45.78–49.41 MiB/s | 11.27–11.44 MiB         | 0.48–0.69 s             |

The fixture observed at most 1 and 4 concurrent response streams respectively;
request counts were 2 and 5 (one probe plus the transfer streams). CPU and peak
memory come from the engine process's Windows process metrics while it is still
alive after completion. They include startup/queue/checkpoint/assembly work, but
exclude the server, test harness and GUI/WebView processes. Wall time includes
queue dispatch and final assembly. OS caches were warm, with no cache flush.

**Inference:** parallel requests improve this deliberately per-response paced
workload. **Limits:** this is not a WAN/TLS result, disk saturation test, cold
startup measurement, IDM comparison or a claim of a universal speed multiplier.
Real servers can throttle an entire client, reject ranges or cap connections.
