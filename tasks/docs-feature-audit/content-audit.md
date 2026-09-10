# Content and generation audit

Status: in progress. This report records source and rendering findings only; it does not qualify any guide or example as passing.

## Scope and evidence

- Baseline: `fa6041fc7b08fc5866099769038e43c44c1ce8df` on `tyler/docs-feature-audit`.
- Initial matrix: React with LangGraph Python, LangGraph TypeScript, Google ADK, AWS Strands, and the built-in agent. The inventory owner is reconciling the 187 manifest outcomes into canonical guide units.
- Content resolution differs by integration: LangGraph Python, LangGraph TypeScript, ADK, and Strands are generated-mode routes that use root MDX before sparse overrides; the built-in agent is authored-mode and takes its own MDX before root fallback. LangGraph variants share one docs folder, while ADK and Strands use legacy folder aliases.
- Browser code blocks resolve through the generated catalog plus `demo-content.json`. Raw Markdown/LLM routes share source selection and scoped-content filtering, but use an independent snippet resolver. Both surfaces must be checked.

## Confirmed defects

1. `CONTENT-GEN-001` — HTML marks quarantined cells unsupported while raw Markdown/LLM output ignores that status and emits bundled code or falls back to another framework. See `content-defects.json` for contexts and exact evidence.
2. `CONTENT-GEN-002` — Google ADK advertises two manifest-wired feature routes whose root and ADK override sources are both absent. A local production probe confirmed HTML 200 pages titled only `google-adk` but Markdown 404 endpoints for both routes.
3. `CONTENT-GEN-003` — selected guides still embed the external Feature Viewer instead of a Showcase-owned cell; Markdown has no source extraction for those frames (11 contexts).
4. `CONTENT-GEN-004` — Declarative Hashbrown and JSON Render have real guides and wired demos, but no feature-catalog mapping to those guides (10 contexts).
5. `CONTENT-GEN-006` — a transitive Built-in Agent tool-rendering snippet assigns v1's named-registration meaning to v2 `useRenderToolCall`; current v2 uses `useRenderTool` for that job (4 contexts).
6. `CONTENT-GEN-007` — the Built-in Agent config demo publishes controls through `useAgentContext`, while its in-process factory reads only provider `properties`/`input.forwardedProps`; the controls therefore do not drive the documented factory contract.
7. `CONTENT-GEN-009` — Strands requires a custom state/context prompt bridge for shared-state read/write, read-only context, and agent config, but supplies no native setup fragment for those three guides.
8. `CONTENT-GEN-010` — the supported Built-in Agent fixed-schema A2UI route has a visible `Missing snippet` alert for its selected schema-inline source region, despite 200 HTML and Markdown responses.

## Candidate setup-contract gap

- `CONTENT-GEN-005` — 35 selected wired/stub cells request setup fragments that their selected integration does not bundle. HTML silently omits the setup; Markdown reports a skipped block. Semantic comparison now clears 30 as already covered by the routed source or runtime, identifies one as a branch that does not render, promotes three Strands contexts to `CONTENT-GEN-009`, and retains one Strands recipe path as a behavior candidate. The raw structural count is preserved in JSON; it is not a claim that every guide needs new prose.

## Candidate behavior finding

- `CONTENT-GEN-008` — the Strands recipe demo writes `state.recipe`, but its installed prompt-lifting function only adds `preferences` and `todos`. The manifest promises the agent reads the recipe. This needs the runner's targeted local AIMock result before it can be promoted from a source candidate.

## Current source findings that require no defect label yet

- The generated registry rejects a feature when it appears in both `features` and `not_supported_features`; the catalog gives `not_supported_features` priority. Retained demo entries are permitted and are intentionally used for quarantined examples. They are not independently obsolete.
- The demo-content bundler fails for missing highlighted source and extracts named regions, preventing silent stale source references. This validates only bundle integrity, not semantic accuracy or runnable behavior.
- Per-package `docs-links.json` paths resolve to a mixture of root guide sources and framework overrides. The route resolver intentionally chooses root MDX first for generated frameworks, except quickstart and threads import; authored built-in pages choose their own source first. The inventory needs to retain the resolved source, not just the docs-links path.
- The three unresolved source families (`background-agents`, `observational-memory`, and `browser-use`) are unshipped for all selected five integrations; their absence is not a selected-guide defect. The two Google ADK unresolved cells are declared wired and remain a defect.
- Static scan of all 40 resolved selected guide sources found frontmatter titles/descriptions, no version-pinned SDK install advice, and no `/reference/v1/` links. This does not replace a rendered link check.

## Explicit review coverage (checkpoint)

- **Completed, static:** resolution and source-unit inventory for all 220 selected matrix cells; 40 unique resolved MDX source units plus 11 transitive shared snippets (51 reviewed source units total); every manifest-wired/stub cell with a resolved source; source frontmatter and deprecated-reference scan; transitive `FrameworkSetup` import scan against each selected integration's setup-fragment ownership; catalog-to-guide binding review; generated/authored route precedence; and browser/Markdown source-resolution paths. The exact 40 route sources and their selected cells are recorded in `inventory.json` (`selected_matrix[].resolved_content`); the 11 transitive snippets are under `content/snippets/shared/{app-control,basics,generative-ui,guides,inspector}`.
- **Completed, static defect triage:** every selected source absence was checked against manifest applicability. The only declared-wired unresolved routes are the two Google ADK entries in `CONTENT-GEN-002`; unshipped selected combinations are deliberately excluded. Semantic review classified every one of the 35 `CONTENT-GEN-005` setup requests: 30 need no package-owned setup beyond selected guide content/runtime behavior, one is gated out for its framework, three are confirmed Strands omissions (`CONTENT-GEN-009`), and one is the Strands recipe behavior candidate (`CONTENT-GEN-008`).
- **Completed, rendered local docs evidence:** a production shell-docs build and expanded 362-response HTML/Markdown route audit. This uncovered the selected Built-in Agent A2UI missing-snippet alert (`CONTENT-GEN-010`); the lone Strands rendered missing-demo alert belongs only to unshipped feature IDs and is not recorded as a selected supported-guide defect. See `full-route-audit.md`.
- **Completed, static API/link sweep:** all 40 resolved MDX units were scanned for 85 Markdown links (including 13 external and 72 internal/anchor links). No selected unit links to `/reference/v1/`, and the selected-guide deprecated API scan found no `useCoAgent`, `useCopilotAction`, or v1 package imports. Internal links without a direct MDX file resolve through the documented frontend-content aliases or framework route resolver; none is recorded as a broken link from source absence alone. API semantics are otherwise covered by `CONTENT-GEN-006` and `CONTENT-GEN-007`.
- **Pending:** editorial, line-by-line prose review of the 40 resolved units and 11 transitive snippets remains a manual-quality row; generator/typecheck/build reconciliation after eventual fixes; and local AIMock behavior. The report remains in progress until these rows are complete.

## Dependency snapshot

Public registry snapshot, read-only on 2026-09-10: `@copilotkit/react-core` 1.71.0, `@langchain/langgraph` 1.4.14, `@ag-ui/client` 0.0.59, Python `copilotkit` 0.1.96, `langgraph` 1.2.11, `google-adk` 2.8.0, and `strands-agents` 1.55.1. Repository pins are not changed and do not by themselves qualify latest-stable guidance.

## Validation still required

- Complete the remaining readability/API-link review across all resolved source units and shared snippets. The inventory identifies 31 canonical catalog routes and 40 actual resolved MDX sources. Fifteen unresolved cells are unshipped selected combinations; two are the wired ADK defect; ten wired BYOC cells have guides but lack catalog mapping.
- Run the shell-docs generator/build/typecheck and route probe when the shared local dependency setup is available.
- Treat the runner's isolated D6/AIMock results as local replay evidence only. The test command is `cd showcase && bin/showcase test <slug> --d6 --direct --isolate <unique> --verbose --cycle`; no behavior result has been attributed to this content audit yet.
