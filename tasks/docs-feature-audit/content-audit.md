# Content and generation audit

Status: in progress. This report records source and rendering findings only; it does not qualify any guide or example as passing.

## Scope and evidence

- Baseline: `fa6041fc7b08fc5866099769038e43c44c1ce8df` on `tyler/docs-feature-audit`.
- Initial matrix: React with LangGraph Python, LangGraph TypeScript, Google ADK, AWS Strands, and the built-in agent. The inventory owner is reconciling the 187 manifest outcomes into canonical guide units.
- Content resolution differs by integration: LangGraph Python, LangGraph TypeScript, ADK, and Strands are generated-mode routes that use root MDX before sparse overrides; the built-in agent is authored-mode and takes its own MDX before root fallback. LangGraph variants share one docs folder, while ADK and Strands use legacy folder aliases.
- Browser code blocks resolve through the generated catalog plus `demo-content.json`. Raw Markdown/LLM routes share source selection and scoped-content filtering, but use an independent snippet resolver. Both surfaces must be checked.

## Confirmed defects

1. `CONTENT-GEN-001` — HTML marks quarantined cells unsupported while raw Markdown/LLM output ignores that status and emits bundled code or falls back to another framework. See `content-defects.json` for contexts and exact evidence.
2. `CONTENT-GEN-002` — Google ADK advertises two manifest-wired feature routes whose root and ADK override sources are both absent, so readers get the unavailable-framework fallback.
3. `CONTENT-GEN-003` — selected guides still embed the external Feature Viewer instead of a Showcase-owned cell; Markdown has no source extraction for those frames (11 contexts).
4. `CONTENT-GEN-004` — Declarative Hashbrown and JSON Render have real guides and wired demos, but no feature-catalog mapping to those guides (10 contexts).

## Candidate setup-contract gap

- `CONTENT-GEN-005` — 35 selected wired/stub cells request setup fragments that their selected integration does not bundle. HTML silently omits the setup; Markdown reports a skipped block. This includes A2UI for all five agents, tool rendering for four agents, and core concepts for Strands and the built-in agent. The missing fragment is structural evidence only: semantic comparison with the routed demo/backend is still required to distinguish deliberately empty setup from missing guidance.

## Current source findings that require no defect label yet

- The generated registry rejects a feature when it appears in both `features` and `not_supported_features`; the catalog gives `not_supported_features` priority. Retained demo entries are permitted and are intentionally used for quarantined examples. They are not independently obsolete.
- The demo-content bundler fails for missing highlighted source and extracts named regions, preventing silent stale source references. This validates only bundle integrity, not semantic accuracy or runnable behavior.
- Per-package `docs-links.json` paths resolve to a mixture of root guide sources and framework overrides. The route resolver intentionally chooses root MDX first for generated frameworks, except quickstart and threads import; authored built-in pages choose their own source first. The inventory needs to retain the resolved source, not just the docs-links path.
- The three unresolved source families (`background-agents`, `observational-memory`, and `browser-use`) are unshipped for all selected five integrations; their absence is not a selected-guide defect. The two Google ADK unresolved cells are declared wired and remain a defect.
- Static scan of all 40 resolved selected guide sources found frontmatter titles/descriptions, no version-pinned SDK install advice, and no `/reference/v1/` links. This does not replace a rendered link check.

## Explicit review coverage (checkpoint)

- **Completed, static:** resolution and source-unit inventory for all 220 selected matrix cells; 40 unique resolved MDX source units; every manifest-wired/stub cell with a resolved source; source frontmatter and deprecated-reference scan; transitive `FrameworkSetup` import scan against each selected integration's setup-fragment ownership; catalog-to-guide binding review; generated/authored route precedence; and browser/Markdown source-resolution paths.
- **Completed, static defect triage:** every selected source absence was checked against the manifest applicability. The only declared-wired unresolved routes are the two Google ADK entries in `CONTENT-GEN-002`; unshipped selected combinations are deliberately excluded. Every missing setup fragment affecting a wired/stub selected cell is enumerated in `CONTENT-GEN-005` as a candidate setup-contract gap.
- **Pending:** semantic classification of each `CONTENT-GEN-005` setup request against its demo/backend; line-by-line human readability and API-link target review across the 40 resolved units and their transitive shared snippets; framework-scoped HTML/Markdown route probes (including redirects/middleware); generator/typecheck/build; and local AIMock behavior. The report remains in progress until these rows are complete.

## Dependency snapshot

Public registry snapshot, read-only on 2026-09-10: `@copilotkit/react-core` 1.71.0, `@langchain/langgraph` 1.4.14, `@ag-ui/client` 0.0.59, Python `copilotkit` 0.1.96, `langgraph` 1.2.11, `google-adk` 2.8.0, and `strands-agents` 1.55.1. Repository pins are not changed and do not by themselves qualify latest-stable guidance.

## Validation still required

- Complete the remaining readability/API-link review across all resolved source units and shared snippets. The inventory identifies 31 canonical catalog routes and 40 actual resolved MDX sources. Fifteen unresolved cells are unshipped selected combinations; two are the wired ADK defect; ten wired BYOC cells have guides but lack catalog mapping.
- Run the shell-docs generator/build/typecheck and route probe when the shared local dependency setup is available.
- Treat the runner's isolated D6/AIMock results as local replay evidence only. The test command is `cd showcase && bin/showcase test <slug> --d6 --direct --isolate <unique> --verbose --cycle`; no behavior result has been attributed to this content audit yet.
