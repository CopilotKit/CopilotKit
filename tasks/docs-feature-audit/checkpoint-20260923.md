# Pause checkpoint — September 23, 2026

Paused at a planned stopping point. **The goal is not complete.** Three of the five integrations now pass their full strict local replay matrix on current stable dependencies with unpatched published CopilotKit 1.73.3. None has finished reader review or live-provider proof.

## Verified and committed (all pushed to `tyler/docs-feature-audit`)

| Area                           | Result                                                                                                                              | Key commits                                                                                      | Evidence                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Branch currency                | Merged origin/main (`5b02c0254a`); upstream #7064 replaced the branch core URL patch; published 1.73.3 contains the fix             | `1938c2c754`, `72e0c2de47`                                                                       | hill-climb iterations 37–38                                 |
| Docs guard (selected five)     | **179/179** runnable bindings (was 127/186 when first measured mid-repair); 8 printed, independently reviewed exclusions            | `c3de380c93`…`834f867d45`, `a15bedca88`                                                          | guard-bindings-_-20260923_.log                              |
| Guard honesty                  | Markdown no longer substitutes another framework's code; unresolved bindings, wrong cells, skip markers and mismatched notices fail | `6728bd0665`, `7ebd428fae`, `f2bd517ce2`                                                         | REPAIR-030/031/039                                          |
| LangGraph TypeScript           | **40/40** strict replay; setup boots from a fresh copy                                                                              | `4fcee0bb4b`, `8cec916e5e`, `0e3fc47f23`, `5fee65149d`, `0c7796721b`, `f7a1cb4b8e`, `4d5a8802c6` | lgts-runtime-matrix-20260923b.md, lgts-mcp-apps-20260923.md |
| LangGraph Python               | **40/40** strict replay, first run; LangSmith and FastAPI BYO paths boot                                                            | `feb4591dce`, `0828d39b45`                                                                       | lgp-runtime-matrix-20260923.md                              |
| Google ADK                     | **40/40** strict replay, first run (three batches to stay under 11 GB); guide Python floor corrected to 3.10                        | `470d4f597f`, `b2323ec714`, `4671e32887`, `5a6670620e`                                           | adk-runtime-matrix-20260923.md                              |
| Shared-state read (REPAIR-035) | Agents now actually read the UI-published recipe; probe fixed for every integration; red→green on LGTS, LGP, ADK                    | `d9467aa407`, `71f6525af9`, `0c7796721b`                                                         | the three matrix records                                    |
| Voice (REPAIR-028/034)         | One shared transcription policy; strict AIMock upload test with its file-content limitation asserted                                | `1e6d0d1c50`                                                                                     | REPAIR-028/034                                              |
| Product fixes                  | Runtime rejects empty audio with 400; `@copilotkit/shared` peer bounded below AG-UI 1.0                                             | `d9a155995f`, `a4e9126d08`                                                                       | REPAIR-029/044 (unreleased)                                 |

Before/after reader comparison (private to the owner): https://claude.ai/artifact/4k2yZEzDqz8S5vYrZ155C7

## Not yet done

1. **Strands**: full strict matrix on current stable deps; shared-state-read red→green; setup reproduction; smoke-route check.
2. **Built-in Agent**: recheck on unpatched 1.73.3 (last result 38/38 published used a local core patch); @tanstack/ai 0.35→0.58 bump needs its own retest; REPAIR-033 (voice openai v5 vs v6 types) and REPAIR-041 (delegation log may reset).
3. **Full docs suite and docs build** have not been rerun since the merge; only focused files (plus guard) are green. `intelligence-quickstart-docs` fails on main already (references a deleted page).
4. **Reader review** of rendered HTML/Markdown for the selected guides, including Copy Prompt output.
5. **Unproven by design so far**: real microphone capture and transcription, browser paperclip upload, and any live-provider behavior. Every runtime result is AIMock replay, host-native (not Docker).

## Decision needed from the owner

- `validate-pins` (Showcase CI) treats CopilotKit 1.68.2 as canonical. It was already failing on this branch; the 1.73.3 bumps add about 5 failures per integration. Either move the fleet canonical pin to 1.73.3 or record exceptions for the selected integrations before merge.

## Follow-ups outside the selected five (tracked, not fixed)

- `/api/smoke` false positive in 18 other integrations and the `create-integration` scaffold.
- 42 Markdown renders now show honest skip markers (deepagents 30, ag2 4, others) where they used to show foreign code.
- 13 integrations still route transcription through `OPENAI_BASE_URL`; reasoning-chain demo is 21 per-integration copies (REPAIR-040); shared hitl demo ships dead `useInterrupt` code (REPAIR-037); Strands beautiful-chat advertises MCP Apps it lacks (REPAIR-036).
- AIMock: reasoning-before-role stream shape and `developer`-role matching (issue text drafted in lgts-mcp-apps-20260923.md, not posted); `showcase/scripts` AIMock pin 1.37.4 is stale.

## Safe restart order

1. Read this file, `hill-climb.md`, `repair-status.json`, `showcase/AGENTS.md`; `git pull --ff-only`; confirm a clean tree and no audit processes.
2. Strands stack, using the ADK record's method (batches, 11 GB cap, 24 h publish-age bound, red/green for shared-state-read, setup reproduction).
3. Built-in Agent recheck on 1.73.3, then the TanStack AI bump as a separate step.
4. Full docs suite (bounded workers, heap cap via `--execArgv`) and docs build; then rendered reader review; then republish the before/after page.

## Resource notes

Audit peak this session: 12.95 GB (LGP single boot, about 50 s). The Next dev server alone can reach ~8 GB; batch the matrix. Other sessions on this machine regularly drive load above 25 — measure the audit's own share before throttling. All audit servers, AIMock, samplers and docs servers are stopped; ports 3100/3101/3103/3910/4410/4411/8000/8123/8124/2024 are free. The user's app on port 3000 was never touched.

Checkpoint commits save progress for resumption. They are not a merge, release, deployment, or claim of full qualification.
