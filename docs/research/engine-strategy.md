# Engine strategy: local feasibility evidence

- Question: can a small Rust core satisfy explicit range/identity control, and
  what does reusing aria2 save or add for this project's scope?
- Date: 2026-10-16; linked issue [#2](https://github.com/Lord-shaban/ZipZap/issues/2).
- Environment: Windows 11 Pro x64, OS version 10.0.26200; Node 24.19.0;
  rustc 1.99.0 (`b940084d7`), Cargo 1.99.0; reqwest 0.13.5; Tokio 1.53.3.
- Method: independently authored local HTTP fixture and child-process observation.
  No REA decompilation, native binary inspection, or IDM investigation was performed.

## Target identity

aria2's official `release-1.37.0` Windows x64 asset was downloaded from the
[upstream release](https://github.com/aria2/aria2/releases/tag/release-1.37.0):

```text
Asset: aria2-1.37.0-win-64bit-build1.zip
Observed local SHA-256:
67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288
Executable reports: aria2 version 1.37.0
Release source commit: 02f2d0d8472b3c38c29b4dba8c75ebd5fdd2899a
```

The release API supplies no asset digest. The hash above identifies the acquired
file; it is not an independently published upstream signature or attestation.
The archive/executable remain in ignored `.research-local/` and are not redistributed.

## Reproduction

See the [experiment instructions](../../experiments/engine-strategy/README.md).
After a locked build, the full local comparison is:

```sh
node experiments/engine-strategy/compare.mjs /absolute/path/to/aria2c
```

The checked-in [sanitized output](engine-strategy-results.windows.json) records
the scenario outcomes and requests. The deterministic fixture is 8,388,608 bytes,
with SHA-256 `31215c982ebf43f04ee735a7b8225d60c3163d623a2f04aafd2617eda91a3b18`.
The changed representation inverts every fixture byte and supplies a new ETag.
The Rust range probe checks the fixed fixture's expected ETag and If-Range
response before writing; it is not a general metadata-discovery implementation.

## Observed

| Case                           | Rust probe                                          | aria2 1.37.0 with recorded flags                             |
| ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| Two-part download              | Two exact ranges, output digest matches             | Initial request and second-half range, output digest matches |
| Server ignores Range           | Rejects before output creation                      | Completes with correct output digest                         |
| Incorrect Content-Range        | Rejects before output creation                      | Not tested                                                   |
| Same-resource seeded resume    | Appends valid second half, digest matches           | Completes with original digest                               |
| Changed-resource seeded resume | Rejects 200/new identity; original prefix unchanged | Returns success with a mixed representation                  |
| Cancellation                   | Dropping a partial response closes connection       | Terminating the child process closes connection              |

The aria2 resume input was an externally seeded contiguous half-file, with
`--continue=true`, no `.aria2` control file, and no application-side saved ETag.
The server observed no If-Range header on that continuation. This is a bounded
finding about these flags and input state, not a general aria2 vulnerability claim.
No hash was supplied to aria2; the independent harness checks the result's digest.

## Inferred

Both approaches can transfer the fixture and stop work. Reusing aria2 saves
substantial engine functionality, but cannot replace ZipZap's responsibility to
establish resource identity and coordinate app/transfer state. An owned Rust
core gives one place to enforce that contract. This is the rationale for the
[decision](../architecture/0002-download-engine-strategy.md), not a performance result.

## Unknown and deferred

HTTPS behavior, crash recovery, power-loss durability, arbitrary server compliance,
authentication, memory/CPU characteristics, installer overhead, aria2's other
resume modes, and production performance remain unverified. The fixed-size Rust
probe buffers at most 8 MiB, and artificial delays make connections observable.
Do not ship it as a downloader or extrapolate speed claims from this run.

The automated Rust fixture is a repeatable feasibility check on both CI platforms.
Changes to the historical external comparison should preserve the original
version/conditions and record any new result separately.
