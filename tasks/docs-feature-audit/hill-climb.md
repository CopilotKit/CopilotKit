# Documentation hill climb

This is the live progress document for repairing the five selected agent integrations in React:
LangGraph Python, LangGraph JS, Google ADK, Strands, and Built-in Agent.

**Current position: active repair (resumed September 23). No integration is fully qualified yet.**

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

Local execution follows the [resource budget](resource-budget.md): the user-approved 30 GB aggregate ceiling, at most one bounded docs suite, and one framework stack. Interrupted runs are not passes.

## Preserved baseline

- Original audited product source: `fa6041fc7b08fc5866099769038e43c44c1ce8df`.
- Repair baseline after merging current main: `b0079629eae9445f82cae66baf674c091da971ad`.
- Existing evidence: [individual D6 checks](host-d6-check-results.json),
  [runtime failures](runtime-failure-classification.json), [source findings](content-defects.json),
  and [rendered snippet errors](global-rendered-marker-triage.md).
- Original valid replay runs: 155 checks, 144 green, 11 red. ADK could not start. The LangGraph JS
  results below used Webpack because the default Turbopack command failed.
- Keep new results in iteration records; do not overwrite the original failed verdicts.

| Integration      | Original baseline                                  | Current repair status                                                                                                                                                                                                                      | Qualification                      |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| LangGraph Python | 38/40; voice and multimodal failed                 | Latest pinned graph booted; 3 strict local cells green. Full refresh pending.                                                                                                                                                              | Not qualified                      |
| LangGraph JS     | 37/40 under Webpack; default dev broken            | 2026-09-23: current stable deps on unpatched published 1.73.3; strict local matrix **40/40** (0 strict 503s); documented BYO setup boots from a fresh copy. Reader review and live-provider proof pending.                                 | Runtime qualified locally (replay) |
| Google ADK       | UI startup blocked by conflicting routes           | Startup and normal-browser AIMock context fixed; scoped auth/chat/tool evidence green. Full refresh pending.                                                                                                                               | Not qualified                      |
| Strands          | 34/36; voice and multimodal failed                 | Recipe/state bridge and 3 related strict local cells green. Full refresh pending.                                                                                                                                                          | Not qualified                      |
| Built-in Agent   | 35/39; three confirmed fixture gaps plus a timeout | Final 38/39 raw strict local matrix: all 38 published checks pass; the unshipped thread-ID demo remains RED. Uses public 1.71.1 plus local core URL fix; unpatched public package still fails. Voice audio transcription remains untested. | Not qualified                      |

Check counts differ from routed-demo counts because D6 expands some features. The two LangGraph
interrupt demos remain explicitly quarantined pending supported SDK behavior. See the
[count reconciliation](d6-lgp-count-reconciliation.md).

## Workstreams

| Workstream                                       | Current stage | Next proof                                                                    |
| ------------------------------------------------ | ------------- | ----------------------------------------------------------------------------- |
| Local startup and deterministic examples         | Verifying     | Full fresh matrix after ADK and LangGraph JS startup repairs.                 |
| Context, configuration, and state propagation    | Verifying     | Re-run the remaining Strands matrix and render the native setup fragments.    |
| Generated guides and code extraction             | Verifying     | Remaining missing regions and real HTML/Markdown source-selection parity.     |
| Readable framework-specific implementation paths | Implementing  | Complete shared-guide groups and each framework’s setup differences.          |
| Copy prompts and product guides                  | Verifying     | Actual copy/preview behavior and reproducible local setup.                    |
| Complete five-agent verification                 | Investigating | Latest stable dependencies, full matrix, and locally embedded demonstrations. |

The [per-guide reader checklist](selected-reader-sanity.md) tracks all 220 baseline feature/agent bindings and the two additional renderer guides. Its [machine-readable version](selected-reader-sanity.json) separates source, setup, API, prompt, representation, and runtime evidence. Pending checks stay pending.

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

| Iteration | Change                                       | Before                                                                                | After                                                                                                                                                           | Position                                                             |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0         | Preserve audit and merge current main        | Audit-only branch; 37 confirmed defects                                               | Current source baseline established without rewriting audit history                                                                                             | Repair started                                                       |
| 1         | C001 HTML/Markdown support parity            | Three focused cases fail on reconstructed before-state                                | Three pass after the first patch, but independent review found fallback can still leak another framework's code when the requested unsupported cell has no demo | Back to implementing; add missing-demo coverage                      |
| 2         | C013 ADK authentication route ownership      | Exact repair-baseline checkout fails Next startup on duplicate routes                 | Repaired UI and auth demo load; three real feature checks still pending                                                                                         | Verifying, not qualified                                             |
| 3         | ADK normal-browser sanity check              | Harness injects fixture context and its three probes pass                             | Browser without the harness header gets AIMock no-match; new REPAIR-001 remains unresolved                                                                      | Startup repair holds, overall ADK qualification blocked              |
| 4         | C001 fallback edge case                      | Unsupported no-demo framework leaked fallback source                                  | Five focused checks pass; independent review clear (`93796fa393`)                                                                                               | Rendered and broad checks pending                                    |
| 5         | ADK startup and normal browser               | Duplicate routes block startup; browser lacks fixture context                         | Auth, chat, tool rendering pass; normal browser screenshot recorded (`49702a5a17`, `7b55169065`)                                                                | Specific defects qualified; full ADK matrix open                     |
| 6         | C016 canonical Threads prompt                | Shared prompt left unresolved in Markdown                                             | Canonical intent expands after snippet imports (`c9148cfb8a`)                                                                                                   | Rendered reader review pending                                       |
| 7         | C006 tool-rendering source ownership         | Copied examples and stale hook guidance                                               | Shared guide extracts Showcase regions; 11 focused checks pass (`fe8b79f9d2`)                                                                                   | Rendered reader review pending                                       |
| 8         | C014 quickstart identity                     | Client headers treated as identity                                                    | Explicit local single-user example links complete authorization contract (`fa26645237`)                                                                         | Source review clear; rendered checks pending                         |
| 9         | C017 LangGraph JS default dev                | Turbopack runtime route fails resolving diagnostics imports                           | Exact default command succeeds; chat, tool-rendering, frontend-tools probes pass (`1c7c2fb8d8`)                                                                 | Specific startup defect qualified; full agent matrix open            |
| 10        | C002/C004 guide bindings                     | ADK legacy Markdown404; missing catalog paths                                         | Redirects preserve old URLs; 62 focused checks pass (`e93102e3b2`)                                                                                              | Routing fixed; feature behavior separate                             |
| 11        | ADK feature setup sanity check               | Display guide extracts an HITL agent that calls a different tool                      | REPAIR-002 recorded; framework setup selector repair pending                                                                                                    | Back to investigating feature-specific setup                         |
| 12        | C007 Built-in Agent configuration            | Controls placed in context, factory reads forwardedProps                              | Neutral request captures correct controls after repair; three D6 cells pass (`6a58482e54`)                                                                      | Strengthening fixtures to catch regressions                          |
| 13        | REPAIR-002 shared ADK setup                  | HITL source on chart guide; first fix moved mismatch to frontend-tools                | Neutral shared factory region passes all three consumers and six local representations (`7c7a5ff016`)                                                           | Scoped source mismatch qualified                                     |
| 14        | REPAIR-003 HITL scope and clarity            | ADK page recommended native LangGraph interrupts                                      | Tool-based path leads; explicit ADK difference and LangGraph control pass (`b50e674547`)                                                                        | Final reader pass pending                                            |
| 15        | C037/C038 renderer guides                    | Copied outdated APIs and imprecise output contracts                                   | Selected Showcase source, explicit differing schemas, Try-it prompts; 20 local representations pass (`f6ffd97322`)                                              | Final runtime/example demonstration pending                          |
| 16        | REPAIR-004 Markdown framework context        | Bare-root BIA guides fall back to LangGraph snippets                                  | Route-level repair and C010 checks17pass; independent review pending                                                                                            | Verifying source selection across real routes                        |
| 17        | REPAIR-005 copy prompt contract              | Copied --intent flag absent from canonical CLI source parser                          | Latest published CLI verification and compatible repair pending                                                                                                 | Investigating actual setup behavior                                  |
| 18        | C010/REPAIR-004 Built-in schema and Markdown | Wrong schema branch in actual Markdown route                                          | Correct BIA source; 17 regression checks plus docs typecheck/build pass (`620020a53c`)                                                                          | Route defect qualified; feature runtime matrix pending               |
| 19        | REPAIR-005 CLI verification                  | Older local checkout rejected current prompt contract                                 | Current published copilotkit4.9.60 accepts exact Rich Threads intent and generic 12-character-run commands in isolated state                                    | Closed as local version skew; no product defect                      |
| 20        | C008 Strands recipe bridge                   | Direct builder omitted `state.recipe`; strict pre-readiness fixture gate returned 503 | Builder capture contains recipe sentinels and strict gate is green (`cddc381133`)                                                                               | Scoped behavior verified; full Strands matrix open                   |
| 21        | REPAIR-006 shared recipe readiness           | Provisional agent state could be replaced before the first request                    | Canonical frontend waits for readiness; fanout and strict probes green for Strands, LangGraph Python, and LangGraph TypeScript (`cddc381133`)                   | Scoped readiness race qualified locally                              |
| 22        | Shell-docs full-suite progression            | Earlier one-worker run exited at the heap cap without a verdict                       | Final bounded full suite reached 125/126 files and 947/948 tests; the sole remaining failure is a stale MAF Python API assertion after C029 source replacement  | Update that contract-specific assertion, then rerun its focused gate |

| 23 | C019/C023/C024 authored API repairs | AG2 auth used stale copied transport; AGNO link and reader-facing install ranges drifted | Source-backed AG2 auth plus current API/install guidance committed (`a7bc6c8a2a`); focused raw-Markdown suite passed 5 checks | Verifying; local reader/runtime checks remain open |
| 24 | C021 AG2 state rendering | Copied state publisher and route disagreed with Showcase agent | Guide derives publisher, mount, and frontend IDs from Showcase (`3155ef7957`) | Verifying; no AG2 behavior qualification |
| 25 | C032–C034 source-region coverage | Qualified routes showed missing backend/reasoning excerpts | Native regions and raw-Markdown coverage committed (`0fd6f3135e`; 6 focused checks across 4 files) | Verifying representation, not runtime |
| 26 | C035–C036 source-region coverage | Headless/tool-rendering routes lacked compatible excerpts | Bounded frontend/backend regions and regression coverage committed (`88ee9b4e70`) | Verifying; renderer proof remains open |
| 27 | Latest LangGraph Python dependencies | Stable dependency set had not been exercised against native graph boot | Updated requirements and three local D6 cells are green (`24401cb24f`) | Scoped 3-cell evidence only; not integration qualification |
| 28 | User-requested pause checkpoint | C025/C030 edits and REPAIR-008–011 had incomplete reader/runtime gates | Sources and before-state evidence preserved; no new tests or repairs run | Paused by user; no framework fully qualified |
| 29 | Resume from pause checkpoint | Saved source repairs and evidence require focused validation | Dependency/lock review is clear; C025/C030 focused contracts passed; REPAIR-008/010 local representation checks are qualified | Active repair; no framework qualified |
| 30 | C031 honest unavailable route and REPAIR-009 reader path | Pydantic state page taught a non-running copied example; BIA config page exposed real regions without a usable setup/action path | C031 and REPAIR-009 committed (`26691e24fc`); pretypecheck + 70 focused docs tests passed, and strict local reader evidence covers the BIA Try it flow | Pydantic backend gap remains open; full BIA matrix is separate |
| 31 | C028/C029 source-backed MAF guides and REPAIR-012 prompt intent | MAF guides had copied cross-runtime contracts; generic copied prompt lost the feature outcome and could name a bare Markdown source | C028/29 committed (`26691e24fc`), REPAIR-012 committed (`c257bcbb3a`); pretypecheck + 70 focused docs tests passed and hydrated Agent Config copy proved scoped outcome/link | MAF behavior paths and final representative reader checks remain open |
| 32 | REPAIR-013 strict browser fixture transport | Normal local browser traffic lacked an AIMock context, so a strict fixture rejected the guide action | Local-only context fallback and natural action fixture committed (`0177395811`); six D6 control turns and exact casual/expert/detailed reader action are green with patched local core | Registry-only 1.71.1 still lacks REPAIR-011; full BIA matrix remains separate |
| 33 | REPAIR-014–017 selected guide provenance/API family | BIA MCP Apps and Shared State taught retired or invented contracts; selected Display-only, Auth, and Multimodal pages lacked selected Showcase implementation paths | Ten scoped Markdown captures confirm root `auth.mdx` for all five selected Auth routes; source-backed replacements remain staged and branch-aware | Raw-Markdown/render gate pending; no model/provider or full-integration qualification claimed |
| 34 | REPAIR-018 LangGraph TypeScript BYO prerequisites | The TypeScript quickstart route resolves to the shared Python/uv-only bring-your-own flow | Actual TS Showcase package, graph mapping, and dev command identified; no source or guide repair landed yet | Scoped prerequisite repair active; no temporary-app or matrix qualification |
| 35 | REPAIR-019 readonly probe classification | Resource POSTs were counted as agent runs in a local readonly capture | Capture now targets agent/run and ignores resources; 10 unit checks plus a real BIA capture are green (`9a56b9b0e8`) | Test-only correction qualified; runtime behavior remains separate |
| 36 | REPAIR-020 selected multimodal outcome scope | Shared guide promised audio/video behavior while selected cells accept image/PDF and sample only those types | Effective-guide/source audit recorded the mismatch; canonical frontend fanout and scoped content repair pending | Active guide repair; media backends remain unqualified |
| 37 | Resume and merge current main | Branch 946 commits behind main; local core URL patch required; published 1.71.1 incompatible | Merge `1938c2c754` + `72e0c2de47`; upstream #7064 replaces the branch core patch; published 1.73.3 contains the fix (dist inspected) | Published-package compatibility testable again; matrices pending |
| 38 | Independent review of 077c596257 Gen UI/source WIP | Unvalidated state-rendering switch, resolver and guard | Switch correct in principle; 5 blocking defects (missing regions for 6 root-page integrations, incomplete backend regions, card drift, Python hard-coded for LGTS, schemas guide overwritten) plus a guard that could pass missing coverage | Back to implementing |
| 39 | REPAIR-027 Gen UI sources | Root page skipped snippets for 6 integrations; card files drifted; status could stay in progress | `fb2759e69c`: state/backend/wiring regions for 11 integrations, canonical card files, OnRunStatusChanged subscription; drift clean | Runtime proof deferred to matrices |
| 40 | REPAIR-028/034 voice policy and AIMock upload | Three transcription policies; no strict upload check | `1e6d0d1c50`: one shared service; 7/7 service tests via real `/transcribe`; strict AIMock test 7/7 with the file-content limitation asserted | Mic capture and real transcription unproven; REPAIR-029 runtime 0-byte 500 open |
| 41 | REPAIR-030/031 guard and Markdown honesty | Markdown substituted foreign code; guard skipped unresolved bindings and always-pass tests | `6728bd0665`, `7ebd428fae`: explicit skip markers; guard HTML+Markdown per snippet; real run RED 127/186 | 59 failing bindings under repair |
| 42 | REPAIR-032 LangGraph guides and redirects | Python hard-coded for LGTS; schemas guide overwritten; redirect chains | `471f58eed7`, `d14b9af1fc`: URL-driven snippets; read/write at in-app-agent-write; schemas restored; single-hop redirect tests 16/16 | Schemas guide not source-backed |
| 43 | Docs guard families and review | 59 failing bindings; 7 proposed exclusions | Guard 179/179 (8 printed exclusions); 18 focused files 190/190; review fixes committed (`c3de380c93`…`834f867d45`) | Docs representation green; reader review pending |
| 44 | LangGraph TypeScript on current stable | Strict matrix never run on latest pins; published 1.71.1 incompatible | `4fcee0bb4b` deps; first run 39/40 (mcp-apps); `8cec916e5e`, `f7a1cb4b8e`, `4d5a8802c6` → **40/40**; REPAIR-035 red/green; setup boots (`0e3fc47f23`) | Runtime qualified locally (replay) |
| 45 | Product fixes found by the audit | Runtime 500 on empty audio; open AG-UI peer range | `d9a155995f`, `a4e9126d08` with tests | Unreleased until next publish |

Subsequent rows must link the defect IDs, commit, command/result or screenshot, remaining failures,
and next step. Unresolved checks belong here even when another check turns green.

## Pause checkpoint — historical

Work paused at the user's request and has now resumed. The pause was not a block or a completion. The last bounded
shell-docs suite later reached **947/948 passing**; it is still not a complete full-suite pass because one stale MAF Python API assertion remains.
`CONTENT-GEN-025` (CrewAI source-backed HITL rewrite) and `CONTENT-GEN-030`
(active Microsoft Agent Framework interactive selector) later passed their
focused 16-test docs gate (`499a085f62`); reader/runtime gates remain open. `CONTENT-GEN-031` remains a genuine Pydantic product/backend gap:
the current Showcase has no `steps` publisher/runtime that the guide can
truthfully extract. `REPAIR-008` through `REPAIR-011` remain explicit in the
ledger: local embed boot, Built-in Agent guide provenance, hydrated footer
link, and relative runtime URL respectively. The scoped core repair is committed
as `6e7ad99316` with full core checks and patched-local D6 proof. Registry-only
1.71.1 independently remains RED because that release lacks the core repair;
this is a release-availability limit, separate from local repair verification. Copy/View Prompt itself was verified after local hydration; REPAIR-012 addresses the separate feature-intent and scoped-source contract.

## Resume checkpoint — active work

The repair queue is active again. Current source work remains bounded: C025 and C030 have passed their focused
docs contracts and await reader/runtime gates; C028/C029 and C031 passed the 70-test focused gate; C031 remains an explicit Pydantic backend
implementation gap. REPAIR-008 through REPAIR-010 require their planned local
representation checks. REPAIR-011 is locally verified; the separate latest-published 1.71.1
compatibility result is release-blocked because it lacks the core repair. REPAIR-012 keeps generic onboarding plus a scoped feature outcome and passed focused prompt/Markdown plus hydrated-browser checks. No integration is qualified, and
the latest full docs result is 947/948; its sole red assertion is queued for contract-specific correction.

## Local rendered comparisons

The [local rendered repair comparison](repair-render-comparison.md) links the
preserved baseline and current local URLs, response results, and local-only
screenshots for the representation repairs. It is before/after delivery
evidence; runtime qualification remains governed by the gates above.

See [reader sanity observations](reader-sanity-review.md) for issues found by following the actual rendered instructions, including setup mismatches that source-extraction tests missed.

## Independent sanity checks

After each logical repair, review the complete path: selected framework → guide → source snippet
→ local example → expected behavior. After each workstream, run the affected shared checks across
the five-agent matrix and inspect both HTML and Markdown. Before closing this cycle, have an agent
other than the implementer review the final changes and repeat the reader-facing demonstrations.

The [repair sequence](repair-sequence.md) describes the agreed order. This document reports actual
progress; it is not a forecast or a claim that the unfinished work already passes.

## Current verification checkpoint — September 13

- Source-backed selected guide repairs are committed in `f50d3ad853`: 18 focused content contracts and nine command-source bundling checks passed after generation. Full final docs and rendered-reader gates remain pending.
- Canonical React Auth, attachment, and shared-state examples are synchronized to the selected five integrations in `1947f20ccf`. The attachment sample now waits for agent readiness; its unchanged two-turn BIA check passes after the early-click failure. Shared runtime qualification for the other integrations remains pending.
- BIA discovery-route repair `be9052f5c5` and actual-run capture correction `1f9082b919` passed focused review/checks. The full strict BIA matrix is **37/39** in 196 seconds. Voice is still RED before dispatch; an explicitly unshipped thread-ID demo remains RED and is not removed from the evidence. Headless and multimodal pass.
- Actual local image/PDF and nondefault scoped prompt observations are preserved in `547ee9f452`; see [attachment demonstration](built-in-agent-multimodal-browser-20260913.md) and [scoped prompt](copy-prompt-langgraph-typescript-browser-20260913.md).
- Latest ADK and Strands direct Python dependency sets resolve, install, and import in isolated Python 3.12 environments. These are dependency checks, not complete guide or agent qualification.
- Strict tool-followup replay regression and explicit qualification instructions are committed in `0579611845`. The default replay mode for unrelated integrations was preserved.

No integration is fully qualified yet. Local patched behavior, latest published compatibility, exact setup reproduction, and live-provider behavior remain distinct results.

### Built-in Agent final runtime checkpoint

The full run after voice commit `6c38d7ef74` is **38/39 raw checks; 38/38 published checks**. The sole raw failure is the explicitly unshipped thread-ID demo; it remains in the evidence. [Before/after comparison](built-in-agent-runtime-comparison-20260913.md) records all seven changed outcomes. Voice passes the prepared transcript handoff, while actual audio capture/transcription remains a separate open gate. Full documentation/setup qualification and unpatched published SDK compatibility are not inferred from this runtime pass.

The audit-owned BIA UI and AIMock were stopped before starting LangGraph TypeScript.

## Latest pause checkpoint

Paused on September 13 at the user’s request. Audit servers and workers are stopped. See [the restart checkpoint](checkpoint-20260913.md) for verified commits, unfinished source units, exact remaining failures, and restart order. Final BIA replay is 38/38 published checks, with the unshipped raw failure and local SDK patch kept explicit. REPAIR-027 still has a RED selected-guide setup gate; its final state-rendering edit is unvalidated WIP.

## Resume — September 23

- State verified: worktree clean at `077c596257`, equal to the remote; no audit processes running. The unrelated user app on port 3000 is preserved.
- Main merged (`1938c2c754`). The published @copilotkit/\* 1.73.3 packages include the relative runtime URL fix, so the local core patch is gone and each matrix must now run on unpatched published packages.
- Dependency survey (2026-09-23): bump @copilotkit/_ to 1.73.3 and drop web-inspector core overrides; keep @ag-ui/_ at 0.0.59 because CopilotKit pins it exactly and AG-UI 1.0 is not yet supported; keep Next 15; bump Python chains as compatible sets; BIA @tanstack/ai 0.35→0.58 requires its own retest. Only versions at least 24 hours old are used, matching the repository supply-chain rule.
- Guard (real, regenerated data): 186 runnable bindings, **127 pass, 59 fail**. Fixes in progress by guide family.
- Focused docs checks: 14 files, 199/199. Typecheck clean. The full docs suite has not been rerun yet.

- Before/after reader comparison (13 pairs, main `5b02c0254a` vs branch `0c7796721b`): https://claude.ai/artifact/4k2yZEzDqz8S5vYrZ155C7 (private to the owner).
