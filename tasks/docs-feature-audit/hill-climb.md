# Documentation hill climb

This is the live progress document for repairing the five selected agent integrations in React:
LangGraph Python, LangGraph JS, Google ADK, Strands, and Built-in Agent.

**Current position: repair underway. No integration is qualified yet.**

The [per-defect ledger](repair-status.json) tracks all 37 confirmed findings, fix commits,
after-evidence, and independent reviews. New failures found during repairs use separate `REPAIR-*`
records. The original audit register remains unchanged as the
before-state; a repaired issue advances in this ledger rather than disappearing from the audit.

## What counts as reaching the top

Every applicable feature guide must be readable, consistent with its selected framework, sourced
from a working Showcase example, and reproducible locally. Every fixed defect needs a before/after
comparison. Generated HTML, Markdown, code excerpts, setup, and copy prompts must agree.

Latest stable dependency verification is a separate requirement. Replay tests do not prove live
provider compatibility. A missing test, unexplained failure, quarantined feature, or unavailable
credential stays visible; it never becomes a pass through averaging.

All confirmed audit findings remain tracked in the [defect register](defect-register.md). This
repair cycle prioritizes the selected five integrations and shared fixes, then resolves the
remaining audited guide defects. A corrected guide for another integration is not a claim of
full runtime qualification for that integration. Vue, React Native, and further frontend expansion
are not silently counted as complete.

## How to read the hill

| Stage             | Meaning                                                                        | Evidence needed to advance                                                |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Investigating     | The failure is known; the correct repair is still uncertain.                   | Reproduce the failure and identify the owning source.                     |
| Implementing      | The repair is understood and being made in Showcase or its shared docs inputs. | Reviewable source change with the original failure preserved.             |
| Verifying         | A fix exists but is not yet qualified.                                         | Targeted tests, generated output, and actual local behavior.              |
| Sanity review     | Mechanical checks pass; the complete guide is being followed as a reader.      | Correct setup, useful code, expected outcome, API links, and copy prompt. |
| Qualified locally | The scoped outcome works and its before/after evidence is recorded.            | All applicable gates below pass; limitations are explicit.                |

Moving backward is expected when a check finds a regression. Editing a file or obtaining an HTTP
200 is not enough to advance to qualified. Shared cell changes require the same real probe across
at least three relevant cells; frontend and probe copies are not an acceptable shortcut.

## Preserved baseline

- Original audited product source: `fa6041fc7b08fc5866099769038e43c44c1ce8df`.
- Repair baseline after merging current main: `b0079629eae9445f82cae66baf674c091da971ad`.
- Existing evidence: [individual D6 checks](host-d6-check-results.json),
  [runtime failures](runtime-failure-classification.json), [source findings](content-defects.json),
  and [rendered snippet errors](global-rendered-marker-triage.md).
- Original valid replay runs: 155 checks, 144 green, 11 red. ADK could not start. The LangGraph JS
  results below used Webpack because the default Turbopack command failed.
- Keep new results in iteration records; do not overwrite the original failed verdicts.

| Integration      | Original baseline                                  | Current repair status                             | Qualification |
| ---------------- | -------------------------------------------------- | ------------------------------------------------- | ------------- |
| LangGraph Python | 38/40; voice and multimodal failed                 | Investigating                                     | Not qualified |
| LangGraph JS     | 37/40 under Webpack; default dev broken            | Default-command repair under verification         | Not qualified |
| Google ADK       | UI startup blocked by conflicting routes           | Startup and browser context fixed; matrix pending | Not qualified |
| Strands          | 34/36; voice and multimodal failed                 | Investigating                                     | Not qualified |
| Built-in Agent   | 35/39; three confirmed fixture gaps plus a timeout | Investigating                                     | Not qualified |

Check counts differ from routed-demo counts because D6 expands some features. The two LangGraph
interrupt demos remain explicitly quarantined pending supported SDK behavior. See the
[count reconciliation](d6-lgp-count-reconciliation.md).

## Workstreams

| Workstream                                        | Current stage | Next proof                                                                            |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| Local startup and deterministic examples          | Implementing  | ADK starts and existing shared probes run; default LangGraph JS dev works.            |
| Context, configuration, and state propagation     | Investigating | Values reach the actual consumer; message-only fixtures cannot fake a pass.           |
| Generated guides and code extraction              | Implementing  | Matching support decisions in HTML/Markdown; no missing snippets for supported cells. |
| Readable, framework-specific implementation paths | Implementing  | Follow each selected guide; extracted examples, setup, and API references agree.      |
| Copy prompts and product guides                   | Investigating | Reuse current helpers and verify the produced local setup path.                       |
| Complete five-agent verification                  | Investigating | Fresh matrix results, latest-stable versions, and a per-guide sanity review.          |

## Qualification gates for each feature guide

- [ ] Support and limitations are correctly declared for this agent.
- [ ] The example, setup, and relevant source regions are owned by Showcase.
- [ ] HTML and Markdown render the selected implementation without extraction errors.
- [ ] Instructions use current APIs and the exact tested dependency versions.
- [ ] The guide states an outcome, necessary prerequisites, implementation steps, and a test action.
- [ ] The shared behavior check exercises the promised outcome with discriminating assertions.
- [ ] Setup and copy-prompt instructions reproduce the example locally.
- [ ] Before/after evidence is linked and an independent sanity review is recorded.

## Iteration log

| Iteration | Change                                  | Before                                                                | After                                                                                                                                                           | Position                                        |
| --------- | --------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 0         | Preserve audit and merge current main   | Audit-only branch; 37 confirmed defects                               | Current source baseline established without rewriting audit history                                                                                             | Repair started                                  |
| 1         | C001 HTML/Markdown support parity       | Three focused cases fail on reconstructed before-state                | Three pass after the first patch, but independent review found fallback can still leak another framework's code when the requested unsupported cell has no demo | Back to implementing; add missing-demo coverage |
| 2         | C013 ADK authentication route ownership | Exact repair-baseline checkout fails Next startup on duplicate routes | Repaired UI and auth demo load; three real feature checks still pending                                                                                         | Verifying, not qualified                        |

| 3 | ADK normal-browser sanity check | Harness injects fixture context and its three probes pass | Browser without the harness header gets AIMock no-match; new REPAIR-001 remains unresolved | Startup repair holds, overall ADK qualification blocked |

| 4 | C001 fallback edge case | Unsupported no-demo framework leaked fallback source | Five focused checks pass; independent review clear (`93796fa393`) | Rendered and broad checks pending |
| 5 | ADK startup and normal browser | Duplicate routes block startup; browser lacks fixture context | Auth, chat, tool rendering pass; normal browser screenshot recorded (`49702a5a17`, `7b55169065`) | Specific defects qualified; full ADK matrix open |
| 6 | C016 canonical Threads prompt | Shared prompt left unresolved in Markdown | Canonical intent expands after snippet imports (`c9148cfb8a`) | Rendered reader review pending |
| 7 | C006 tool-rendering source ownership | Copied examples and stale hook guidance | Shared guide extracts Showcase regions; 11 focused checks pass (`fe8b79f9d2`) | Rendered reader review pending |
| 8 | C014 quickstart identity | Client headers treated as identity | Explicit local single-user example links complete authorization contract (`fa26645237`) | Source review clear; rendered checks pending |

Subsequent rows must link the defect IDs, commit, command/result or screenshot, remaining failures,
and next step. Unresolved checks belong here even when another check turns green.

## Local rendered comparisons

The [local rendered repair comparison](repair-render-comparison.md) links the
preserved baseline and current local URLs, response results, and local-only
screenshots for the representation repairs. It is before/after delivery
evidence; runtime qualification remains governed by the gates above.

## Independent sanity checks

After each logical repair, review the complete path: selected framework → guide → source snippet
→ local example → expected behavior. After each workstream, run the affected shared checks across
the five-agent matrix and inspect both HTML and Markdown. Before closing this cycle, have an agent
other than the implementer review the final changes and repeat the reader-facing demonstrations.

The [repair sequence](repair-sequence.md) describes the agreed order. This document reports actual
progress; it is not a forecast or a claim that the unfinished work already passes.
