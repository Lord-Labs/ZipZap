# Research and REA

Use research to answer a specific implementation question, not to imply that the
whole reference application has been understood. Public IDM feature descriptions
establish advertised behavior, not internal algorithms or measured performance.

No IDM binary, extension, runtime, or packet capture has been analyzed for this
repository. The current plan is a design proposal based on public documentation.

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
