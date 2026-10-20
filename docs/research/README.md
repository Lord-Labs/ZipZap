# Research and REA

Use research to answer a specific implementation question, not to imply that the
whole reference application has been understood. Public IDM feature descriptions
establish advertised behavior, not internal algorithms or measured performance.

The [IDM desktop reference](idm-desktop.md) records a bounded REA resource
inventory and separate main-window observations of installed IDM 6.43. No IDM
download algorithm, extension or packet capture has been analyzed. ZipZap's
implementation is independently authored and verified against its own fixtures.

The separately recorded [engine strategy comparison](engine-strategy.md) uses a
local HTTP fixture with reqwest/Tokio and an official aria2 Windows binary. It
does not analyze IDM or establish production performance.

The [daily-use performance baseline](performance.md) records current-core
controlled transfers and the bundled UI with a real headless-core bridge for
issue #46, including raw repetitions, investigation budgets and no-go decisions
on speculative optimization. Actual WebView2 resource/interaction repetitions
are recorded separately; repeated cold-start qualification remains pending.
Chromium results do not establish native app performance.

## Next-phase study

The [next-phase feature study](next-phase-features.md) maps the inspected ZipZap
baseline and official IDM/platform documentation to the accepted M6 backlog and
separate M7 decisions. It reuses existing REA evidence and does not claim new
native analysis, runtime verification or performance results.

## Tools

- [Ponytail](https://github.com/DietrichGebert/ponytail) guides small complete changes
  throughout the project. It is optional for contributors and does not replace review.
- [REA](https://github.com/morluto/rea) is appropriate for evidence from a shipped
  artifact or runtime. Its skill supplies instructions; using its tools requires
  a separate CLI/MCP installation and sometimes a native analysis engine.
- Read REA's current official installation instructions before setup. Select only
  the needed client/provider, inspect configuration changes, and preserve existing
  configuration. Do not install paid or unrelated tools as an incidental step.
- Normal source-repository analysis uses ordinary code tools; REA is not required.

## Investigation protocol

1. Write the narrow question and its relevance to an accepted issue.
2. Identify the exact artifact/version/hash or public page and access date.
3. Record tools and versions, the inspected scope, evidence references, and limits.
4. Separate **observations**, **inferences**, and **unknowns**. Static analysis is
   not a claim of runtime behavior. A marketing statement is not a benchmark.
5. Record an implementation implication and a test that could confirm it for
   ZipZap. Keep the implementation independently authored; preserve any necessary
   attribution and dependency notices.

Keep binaries, browser profiles, credential-bearing captures, and detailed private
output outside Git, for example in ignored `.research-local/`. Commit only
sanitized notes needed for the decision. Do not publish proprietary artifacts,
private URLs, tokens, or personal data in issues or PRs.

## Short finding template

```text
Question / linked issue:
Target, version, hash or URL, date:
Tool and version:
Evidence references / exact inspected scope:
Observed:
Inferred:
Unknown / limitations:
Implication for ZipZap:
Verification plan:
```

## Current public sources

- [IDM advertised features](https://www.internetdownloadmanager.com/)
- [REA instructions](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md)
- [Ponytail instructions](https://github.com/DietrichGebert/ponytail/tree/main/skills/ponytail)
- Protocol and framework sources are linked in the [architecture decision](../architecture/0001-project-direction.md).
