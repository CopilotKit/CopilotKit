# AWS Strands (Python): first full qualification on published CopilotKit 1.77.0 and AG-UI 1.0 (2026-10-06)

**Verdict: qualified, 41 of 41 unique checks (42 of 42 executions), in both full runs.** This is Strands' first full strict qualification in this audit. The 09-13 host baseline was 34 of 36, with `voice` and `multimodal` failing (`strands-host-d6-esm.log`); both now pass on their first attempt in both runs.

The first full strict D6 run, at `96eb243ad2`, passed every check on its first attempt. All 146 AIMock requests returned 200, and each one carries `x-aimock-context: strands`, `x-aimock-strict: true` and `x-test-id`. A final full run on fresh boots at `602a595fe2`, after the fixes below, gave the same result.

The work found and fixed four defects. None of them showed up as a red cell in the matrix:

- **The documented `npm run dev` never started the agent.** It ran uvicorn from the integration root, but `agent_server.py` lives in `src/` (`7a25baa55b`).
- **`/api/smoke` reported success when a run failed** (`96eb243ad2`).
- **The `shared-state-read` fixture accepted any recipe.** It is now gated on the probe's edited title (`92a42187ec`).
- **Beautiful Chat suggested an MCP App that its runtime did not serve** (REPAIR-036, `d3e97093aa`).

One HITL setup sentence was also made precise (`602a595fe2`). No shared source changed.

|                                      | Result                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First run (raw / published)          | **42/42 executions, 41/41 unique checks** at `96eb243ad2`. 0 feature retries. 146 requests, all 200; 146/146 carry all three forwarded headers.                                                                                                                                                                  |
| Final run (raw / published)          | **42/42 / 41/41** at `602a595fe2`. 0 feature retries. 146 requests, all 200; 146/146 with the headers.                                                                                                                                                                                                           |
| Voice and multimodal (baseline red)  | **Pass in both runs.** `voice`: 5.0 s, then 4.5 s. `multimodal`: 8.0 s, then 8.3 s. The multimodal requests carried `image_url` and `file` parts. The voice transcript handoff reached the agent and matched its fixture.                                                                                        |
| `shared-state-read` (mandatory)      | **Gated** on "Lemon Saffron Orzo" in the final **user** turn. Strands has no per-run system-prompt hook, so the gate cannot sit on the system message. **GREEN**: 4/4 with its neighbours. **RED**, with `_format_recipe_block` stubbed: fails on both attempts, 12 × strict 503. **GREEN** again once restored. |
| `/api/smoke`                         | **RED**: 200 "ok" while the run ended in `RUN_ERROR 400`. **GREEN** after the ADK/LGP fix: 200 "ok" on a good run, and 502 `run_error` with the same queued 400.                                                                                                                                                 |
| A2UI / `generate_a2ui`               | **The LGP stub pattern is absent.** The shipped fixtures already run the 3-call flow. An instruction-gated scratch fixture set: **GREEN** twice (12 requests, 13.4 s). With an LGP-style raising stub: **RED** (`surface-missing`). The stub was not committed.                                                  |
| HITL native interrupt                | The guide's claims match the running `/interrupt` agent: pause, `outcome.type "interrupt"`, and the `{"response": …}` / `{"cancelled": True}` wrapping. One sentence was made precise: the `reason` object arrives as `metadata.reason`.                                                                         |
| Beautiful Chat MCP Apps (REPAIR-036) | **RED**: the suggestion's tool call returned "Unknown tool: create_view", with 15 tools advertised. **GREEN** after adding `mcpApps`: 16 tools, the live Excalidraw server answers, and an `mcp-apps` activity is emitted.                                                                                       |
| Static checks                        | `compileall`, an import of `agent_server` (9 mounts, 10 agents), `uv pip check` (111), pytest 71/71, `next build` and the four validators pass. `validate-pins` goes from 47 to **53** FAILs, because Strands left the canonical 1.68.2.                                                                         |
| Bring-your-own setup                 | **PASS as written** (and with `@ag-ui/client@1.0.1`). The extractor accounts for all 25 fenced blocks. The guide's agent boots, and a run through the guide's own `route.ts` reaches `RUN_FINISHED`. No guide change was needed.                                                                                 |
| Docs checks (under the lock)         | pretypecheck and typecheck pass; guard 25/25; `current-v2-authored-guides` + `llm-text` 72/72.                                                                                                                                                                                                                   |
| Peak audit RSS                       | **9.01 GB** (8,803,616 KiB), during the all-41-pages pre-warm of boot 1. The matrix peak was 8.63 GB (final A2). The 10.5 GB abort line never fired.                                                                                                                                                             |

## Provenance

- **Worktree.** `tyler/docs-feature-audit`. `git pull --ff-only` was a no-op at `078a361d85`, and the tree was clean.
  - The dependency update is `f60140043a`.
  - The Python static checks, pytest, `next build` and the validators ran on the uncommitted update just before that commit.
  - The full matrix ran at `96eb243ad2`, with `showcase/` clean.
  - The red/green checks, A2UI checks and probes ran at the HEAD named in each log. The temporary red and negative-control edits named below were never committed.
  - The final matrix ran at `602a595fe2`. The setup reproduction ran at `602a595fe2`, plus its then-uncommitted scripts (`9a738b16f1`). The docs checks ran at `9a738b16f1`.
- **CopilotKit is unpatched and registry-published** (`strands-copilotkit-provenance-20261006.log`).
  - **JS.** All 27 `@copilotkit/*` and `@ag-ui/*` lock entries resolve from `registry.npmjs.org`. Each one's lock integrity equals the registry's `dist.integrity`. The lock has 0 `link:`, `file:` or git sources.
  - **Python.** `ag_ui_strands` 0.4.1, `ag-ui-protocol` 1.0.0, `strands-agents` 1.57.2, `strands-agents-tools` 0.8.9, `copilotkit` 0.1.96 and `ag-ui-a2ui-toolkit` 0.0.4 were installed by uv from `https://pypi.org/simple`, with no `direct_url` (0 in the venv).
- **Toolchain.**
  - The UI lock was generated with Node v24.11.0 / npm 11.6.1, as LGTS, LGP and ADK did.
  - `npm ci`, the stack, the runner, `next build`, the validators, the setup reproduction and the docs checks ran on Node v22.16.0 / npm 10.9.2.
  - Python is a uv 0.11.7 venv on host CPython 3.12.6; the Dockerfile uses 3.12.13. `@copilotkit/aimock` is 1.37.4.
- **One stack at a time.** Only this stack, its AIMock and the scratch AIMocks below ran. Port 3000 was never touched. The other checkouts' `next dev` servers on 3061 and 3063 were not signalled.

## 1. Dependencies

### Python (`requirements.txt`, `strands-python-install-20261006.log`)

The update was resolved with `uv pip install -r requirements.txt --exclude-newer 2026-10-05T21:00:00Z --index-url https://pypi.org/simple` (the LGP/ADK bound).

- **All 111 resolved packages were dated individually** (`strands-python-resolution-20261006.json`): **0 violations**. The youngest is `langgraph` 1.2.13, at 29.5 h.
- **`uv pip check`:** all 111 compatible.

| Package                  | Before | After      | Published (UTC)  | Newer, held back                                                   |
| ------------------------ | ------ | ---------- | ---------------- | ------------------------------------------------------------------ |
| `ag_ui_strands`          | 0.4.0  | **0.4.1**  | 2026-09-23 12:45 | none                                                               |
| `strands-agents[OpenAI]` | 1.54.0 | **1.57.2** | 2026-10-01 18:55 | 1.58.0 (10-06 00:00) and 1.58.1 (10-06 21:02), both under 24 h old |
| `strands-agents-tools`   | 0.8.8  | **0.8.9**  | 2026-09-15 22:36 | none                                                               |
| `ag-ui-protocol`         | 0.1.22 | **1.0.0**  | 2026-09-17 18:31 | none                                                               |
| `copilotkit`             | 0.1.94 | **0.1.96** | 2026-08-26 22:31 | none                                                               |
| `langchain`              | 1.2.15 | **1.4.3**  | 2026-09-28 20:17 | none                                                               |
| `langchain-openai`       | 1.1.9  | **1.6.7**  | 2026-09-30 15:12 | none                                                               |
| `openai`                 | 2.54.0 | 2.54.0     | 2026-08-11 18:46 | 3.x (the OpenAI extra requires `openai<3`)                         |
| `fastapi` / `uvicorn`    | floors | floors     | 0.142.2 / 0.54.0 | none                                                               |

**Code change.** strands 1.57.2 still calls `ThreadingInstrumentor().instrument()` unconditionally (`strands/telemetry/tracer.py:122`). The import-order patch in `agent_server.py` therefore stays, and its comment now names 1.57.2.

**Upstream deprecation.** `ag_ui_strands` 0.4.1 now emits `FutureWarning: Implicit wildcard CORS is insecure and deprecated` once per `create_strands_app` call: 10 per boot. The guide's single-app `main.py` does not trigger it in the setup reproduction. Nothing was changed for it.

### JS (`package.json`, `package-lock.json`)

- **`package.json`.**
  - Every `@copilotkit/*` pin moves from 1.68.2 to **1.77.0**: a2ui-renderer, react-core, react-ui, runtime, shared and voice.
  - `@ag-ui/client` moves from 0.0.57 to **1.0.1**, and `next` to `^15.5.27`. `openai` stays at 5.9.0.
  - **The 1.68.2-era `@copilotkit/web-inspector` → `@copilotkit/core` override is removed** from both the npm `overrides` and the `pnpm.overrides` blocks. `@ag-ui/core` and `@ag-ui/client` overrides at **1.0.1** go into both blocks instead.
- **Why the overrides changed.** A probe resolution without any overrides (same command, temp copy) resolved a single `@copilotkit/core` 1.77.0, so the web-inspector override is stale. The same probe left **0.0.59** copies of `@ag-ui/core` and `@ag-ui/client` under `channels-core`, `-intelligence`, `-slack` and `-teams` (`strands-ui-lock-update-20261006.log`). LGTS, LGP and ADK found the same.
- **The lock was regenerated fresh.** The command was `rm -rf node_modules package-lock.json && npm install --package-lock-only --legacy-peer-deps --before=2026-10-05T12:00:00Z`. It gives 948 entries and 0 exotic sources.
- **Age audit** (`strands-ui-lock-age-audit-20261006.json`, run with `lgts-lock-age-audit.mjs`). 301 entries were added or changed: **0 violations**. The youngest is `@modelcontextprotocol/sdk` 1.32.1, at 35.6 h.
- **`npm ci --legacy-peer-deps`** added 891 packages, exit 0.
- **One copy of each** (`strands-dependency-tree-20261006.log`):
  - `@copilotkit/core`, `shared`, `runtime`, `react-core`, `react-ui` and `web-inspector`, all 1.77.0;
  - `@ag-ui/core`, `client`, `encoder` and `proto`, all 1.0.1, and `@ag-ui/langgraph` 0.0.44;
  - `@langchain/core` 1.2.14, `next` 15.5.27, and `react` / `react-dom` 19.3.0.
- **An unused pin.** `@copilotkit/react-ui` is pinned but no file in `src/` imports it. It was left in place.

## 2. Static checks (what Showcase CI runs for this integration)

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileall -f src tools/ _shared/`                                                                     | **Pass** (`strands-python-static-20261006.log`).                                                                                                                                                                                                                                                                                                            |
| Import `agent_server` as uvicorn does (`strands-import-agents.py`)                                      | **Pass.** It mounts 9 sub-apps (`/voice`, `/byoc-hashbrown`, `/byoc-json-render`, `/a2ui-fixed-schema`, `/declarative-gen-ui`, `/a2ui-recovery`, `/interrupt`, `/reasoning`, `/reasoning-chain`) plus the root `POST /`, with 10 agent objects. The script's tool listing reads `None`, because `StrandsAgent` builds per-thread agents.                    |
| `uv pip check`                                                                                          | **Pass**, 111 packages.                                                                                                                                                                                                                                                                                                                                     |
| `pytest tests/python/` (CI's 3.12 leg; CI skips Strands on 3.10)                                        | **71/71** (`strands-python-pytest-20261006.log`). The test dependencies went to a separate `--target` dir.                                                                                                                                                                                                                                                  |
| `next build`                                                                                            | **Pass.** Next 15.5.27, 60 static pages, 28.0 s, max RSS 2.83 GB. The only warnings are the known hashbrown and `@copilotkit/runtime` `channel-manager.mjs` `Critical dependency` lines and the workspace-root warning (`strands-ui-next-build-20261006.log`).                                                                                              |
| `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends`, `validate-fixture-tool-surface` | **Pass** (`strands-ci-validators-20261006.log`). Strands has 41 demos, 41 specs and 38 QA files, with 8 pre-existing warnings.                                                                                                                                                                                                                              |
| `validate-pins` ratchet                                                                                 | **Red before and after; not fixed.** FAIL goes from **47 to 53**, OK from 6 to 5; the baseline is 26. Strands pinned the canonical 1.68.2 and was an OK package. Its six `@copilotkit/*` lines at 1.77.0 now add 6 FAILs, and the hash goes from `dff21530a05f56e8` to `f2b4f09e4b22ba4c`. The pre-update count comes from a `git archive` of `078a361d85`. |

## 3. Boot (documented default command, strict AIMock)

- **AIMock.** The same command and flags as the LGTS, LGP and ADK 10-06 runs: `--strict --validate-on-load --chunk-size 8 --latency 60` with `AIMOCK_STRICT_TURN_INDEX=1`, and no record, proxy or provider flags. It loaded **9056** fixtures (`strands-aimock-20261006.log`). It was restarted after the fixture gate (`strands-aimock-ssr-20261006.log`), again with 9056 fixtures.
- **Stack.** The scripts are `strands-stack-20261006.sh` (derived from ADK's) and `strands-rss-sampler-20261006.sh`. The UI runs on port 3112, the venv is first on `PATH`, and `OPENAI_BASE_URL` points at AIMock.
- **RED: `npm run dev` as written** (`strands-dev-stack-asis-red-20261006.log`).
  - `scripts.dev` ran `PYTHONPATH=. python -m uvicorn agent_server:app` from the integration root.
  - The agent half exited with `Error loading ASGI app. Could not import module "agent_server"`. Only Next came up, and the agent's `/health` never answered.
  - `agent_server.py` lives in `src/`, while `tools` and `_shared` sit at the root.
- **Fix (`7a25baa55b`).** `cd src && PYTHONPATH=.. python -m uvicorn …`, exactly as Google ADK's script does.
- **GREEN** (`strands-dev-stack-20261006.log`).
  - Agent `/health` and UI `/api/health` returned 200 after 3 s.
  - All ten `GET <mount>/ping` returned 200.
  - The runtime's `info` reports **1.77.0** with 40 agents.
- **The same defect elsewhere.** Eight other integrations carry the identical broken script with `src/agent_server.py`: ag2, agno, crewai-crews, crewai-conversational-flows, langroid, llamaindex, ms-agent-python and pydantic-ai. They are outside this run's editable scope and were not changed.
- **Pre-warm** (`strands-prewarm-20261006.log`). All 41 demo pages returned 200. Of the API routes, `/api/copilotkit` and `/api/health` returned 200, the 12 POST-only routes 405 on GET, auth 401, voice 404 and debug 403.

### `/api/smoke` (`strands-smoke-route-20261006.log`, fixed in `96eb243ad2`)

- **BEFORE 1.** The route returned 200 `ok` in 0.55 s while the AIMock journal was still empty. The model request (200, the "Respond with exactly: OK" fixture) arrived afterwards.
  - ag_ui_strands accepts the `smoke-<ms>` thread id: read to the end, the route's own request finishes `RUN_FINISHED` with "OK".
  - So the first-chunk check is the defect, not the thread id.
- **BEFORE 2 (discriminating).** One non-retryable 400 was queued through `/__aimock/error`. The route still answered **200 `ok`**. The same run read to the end goes `RUN_STARTED … RUN_ERROR "Error code: 400 … injected provider failure"`.
- **Fix.** ADK's route from `b2323ec714` (the LGP `0828d39b45` pattern): `randomUUID()` ids, and the stream read to its terminal event. Only the slug and one comment ("Gemini" → "OpenAI") differ.
- **AFTER.**
  - A normal run: 200 `ok` (0.68 s), one fixture match.
  - With the 400 queued: **502 `run_error`** ("Run failed: Error code: 400 …").
  - Unqueued again: 200.
- The smoke-route fix is now in 4 of 21 integrations.

## 4. Full strict D6 matrix

The runner command is the 10-06 one, with `--demos <batch>` (`strands-stack-20261006.sh d6`, driven by `strands-batch-20261006.sh`):

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts strands --demos <batch>
```

- **Batches.** The ADK five-batch split, adjusted to Strands' 41 manifest features. `hitl`, `hitl-in-chat-booking` and `tool-rendering-reasoning-chain` were added to B1. `interrupt-headless` and `gen-ui-interrupt` went to B3. `shared-state-streaming` is a `not_supported_feature`, so it is not in `features`.
- **Each batch** ran as one runner at `FEATURE_CONCURRENCY_D6=4`, on its own fresh boot. Each boot removed `.next`, pre-warmed the batch's pages and every API route, and reset the AIMock journal.

| Batch | Features                                                                                                                                                                                                 | Checks | First run (`96eb243ad2`) | Final run (`602a595fe2`) |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------ | ------------------------ |
| A1    | `beautiful-chat`, `cli-start`, `agentic-chat`, `prebuilt-sidebar`, `prebuilt-popup`, `chat-slots`, `chat-customization-css`, `headless-simple`                                                           | 11     | 11/11, 17 req            | 11/11, 17 req            |
| A2    | `headless-complete`, `reasoning-custom`, `reasoning-default`, `frontend-tools`, `-async`, `gen-ui-tool-based`, `hitl-in-app`, `hitl-in-chat`, `declarative-gen-ui`, `a2ui-fixed-schema`, `a2ui-recovery` | 11     | 11/11, 47 req            | 11/11, 47 req            |
| B1    | `mcp-apps`, `gen-ui-agent`, `tool-rendering-default-catchall`, `-custom-catchall`, `tool-rendering`, `-reasoning-chain`, `hitl`, `hitl-in-chat-booking`                                                  | 7      | 7/7, 45 req              | 7/7, 45 req              |
| B2    | `shared-state-read`, `-read-write`, `readonly-state-agent-context`, `subagents`, `multimodal`                                                                                                            | 5      | 5/5, 15 req              | 5/5, 15 req              |
| B3    | `auth`, `declarative-hashbrown`, `declarative-json-render`, `open-gen-ui`, `-advanced`, `voice`, `agent-config`, `gen-ui-interrupt`, `interrupt-headless`                                                | 8      | 8/8, 22 req              | 8/8, 22 req              |

|                                   | Checks | First run | Final run |
| --------------------------------- | ------ | --------- | --------- |
| Raw (executions)                  | 42     | **42**    | **42**    |
| Published catalog (unique checks) | 41     | **41**    | **41**    |

- **Raw vs published.** `hitl`, `hitl-in-chat-booking` and `hitl-in-chat` all map to `hitl-text-input`. The route precedence in `d5-hitl-text-input.ts` sends all three to `/demos/hitl-in-chat`. Splitting `hitl-in-chat` (A2) from the other two (B1) ran that check twice, so there are 42 executions of 41 unique checks. An unbatched run would count 41. The legacy `/demos/hitl` page (which imports `useInterrupt`) is not exercised.
- **Mapping.** `cli-start` has no D6 type, and `beautiful-chat` expands into 5 checks: toggle-theme, pie-chart, bar-chart, search-flights and schedule-meeting. `declarative-hashbrown` and `declarative-json-render` fold into `byoc`, so **`declarative-json-render` is routed but not directly exercised**. The reasoning, reasoning-chain and both interrupt cells are exercised.
- **Failures and reruns: none.** Both runs had 0 `feature-retry` events, so nothing was rerun. Per-check results and durations are in `strands-runtime-matrix-20261006.json`. Logs are `strands-d6-{full,final}-<batch>-20261006.log`, with matching `strands-dev-stack-…`, `strands-prewarm-…` and `strands-d6-journal-…` files.
- **Journals.**
  - First run: 146 requests, 134 Chat Completions and 12 `/v1/responses` (the reasoning agents). The final run has the same counts.
  - All 200, and all carry `x-aimock-context: strands`, `x-aimock-strict: true` and `x-test-id`. That includes the 9 inner A2UI sub-agent calls in A2 (4 `gen-ui-declarative`, 5 `a2ui-recovery`), which reach AIMock with the headers through the executor ContextVar propagation.
- **AG-UI 1.0.** There was no event- or message-shape breakage. Every run, frontend-tool round trip, state snapshot, interrupt outcome, reasoning stream and activity (A2UI, MCP Apps) cell passed on `ag-ui-protocol` 1.0.0 through `@ag-ui/client` 1.0.1.
- **Stack logs.** No HTTP 500.
  - There was one `unhandledRejection: Unexpected end of JSON input` in Next, in the first run's B2, which passed. LGTS and LGP saw the same.
  - The only Python tracebacks are non-fatal OpenTelemetry `Failed to detach context` errors (`GeneratorExit` when a stream closes): 716 lines over the 10 matrix boots.
- **Slow but expected.**
  - `gen-ui-agent` took 60.9 s: its fixtures step through seven `set_steps` calls per turn, about 2.5 s apart.
  - `auth` took 54.4 s and `agent-config` 33.7 s, both multi-turn.

### Voice and multimodal (failed in the 09-13 baseline)

- **Both now pass on their first attempt in both runs.**
  - `voice` takes 5.0 s, then 4.5 s. The bundled transcript ("What is the weather in Tokyo?") reaches the tool-free `/voice/` agent and matches the `weather in Tokyo` fixture.
  - `multimodal` takes 8.0 s, then 8.3 s. The image turn carries `text` + `image_url` parts, and the PDF turn `text` + `file` parts. Both match their strict fixtures.
- **The 09-13 symptoms.** There, the sample-audio click left the textarea empty, and the multimodal turn timed out with no agent request (`local-runtime-log.md`).
- **Not re-bisected.** Both 09-13 symptoms predate the shared readiness fixes: `93bf96e61f` ("wait for voice sample agent readiness") and REPAIR-020/021 (the multimodal/voice readiness and multiroute repairs). Neither cell needed a Strands change in this run, so no RED was reproduced at the current pins.

## 5. The rechecks asked for

### (a) `shared-state-read`: gated, green and red (`92a42187ec`)

- **Where the recipe goes.** On every turn the journal shows a **system** prompt of the generic showcase agent, without the recipe. The **last user message** is `Current recipe from the editor:\n{"title": "Lemon Saffron Orzo", …}\n\nUser request: …`.
  - That is `build_state_prompt`, the agent's `StrandsAgentConfig.state_context_builder`.
  - `ag_ui_strands` 0.4.1 has no per-run system-prompt hook: `system_prompt` is reserved to the adapter (see `StrandsAgentConfig.thread_agent_kwargs`).
  - So a `systemMessage` gate, as in LGP, ADK and LGTS, cannot match Strands.
- **The fixture.** Both turns now match `userMessage: "Lemon Saffron Orzo"`, with turn 1 `turnIndex: 0`. Before, they matched only the `"Current recipe from the editor"` marker, which a stale or default recipe also produces. The replies now name the recipe, as ADK's do.
- **GREEN** (`strands-d6-redgreen-ssr-green-20261006.log`, fresh boot).
  - `shared-state-read`, plus the neighbours `shared-state-write`, `readonly-state-context` and `agentic-chat`: **4/4**.
  - 9 requests, all 200. Both turns matched the gated fixtures.
- **RED** (`strands-d6-redgreen-ssr-red-20261006.log`, stub `strands-shared-state-read-red-stub-20261006.diff`).
  - `_format_recipe_block` was stubbed to `return None` and not committed.
  - `shared-state-read`: **fail**, `waitForTurnComplete: turn 1 did not complete within 56004ms (reason=dom-missing …)` on both attempts.
  - 12 requests, all bare "Create a delicious Italian pasta recipe.", **all 503**. The OpenAI client retries a 503.
- **GREEN again** (`strands-d6-redgreen-ssr-green2-20261006.log`). `agent.py` was restored, with `git status` clean: pass, 2 gated requests, both 200. The final full run also matched both gated fixtures.

### (b) `/api/smoke`

See §3: RED, then the fix, then GREEN.

### (c) A2UI: the `generate_a2ui` pattern

- **How Strands wires it.** `a2ui_dynamic.py` is a plain `Agent` with no tools. The route sets `injectA2UITool: true`, so `ag_ui_strands`'s `plan_a2ui_injection` registers its own `generate_a2ui` and drops the runtime's `render_a2ui`.
  - "User prevails" is checked against the Strands tool registry by name. So, unlike ADK, it does see an `@tool` function.
  - The shared `/` agent's `generate_a2ui` (`a2ui_generate.py`) is a real secondary-LLM tool, not a raising stub. It serves Beautiful Chat, where `injectA2UITool` is false.
- **The shipped fixtures already run the 3-call flow** (matrix journal A2). For each pill, the outer call advertises `tools=[generate_a2ui]` only and is answered with `generate_a2ui`. Then the inner `render_a2ui` call arrives (headers present; body not journaled), then the `toolCallId` follow-up. `a2ui-recovery` shows the same shape, with 1 and 3 inner attempts.
- **Proof with a fixture that calls `generate_a2ui`.** The scratch set `strands-a2ui-live-order-fixtures-20261006.json` ran on a strict AIMock on :4411, with the stack's `OPENAI_BASE_URL` pointed there (`strands-a2ui-run-20261006.sh`).
  - It holds the same responses as Strands' `gen-ui-declarative.json`, reordered as ADK's set is. The outer call is gated on the agent's prompt (`systemMessage: "embedded sales analyst for Vantage Threads"`) and answers with `generate_a2ui`.

| Run (fresh boot, `--demo declarative-gen-ui`)                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GREEN at `92a42187ec` (`strands-d6-a2ui-green-20261006.log`)                                                       | **Pass, 13.4 s.** 12 requests, all 200. For each pill: the gated outer call returns `generate_a2ui`, then the inner `render_a2ui`, then the `toolCallId` follow-up. All 12 carry the three headers.                                                                                                                                                                       |
| Negative control: LGP-style `@tool generate_a2ui` that raises (`strands-a2ui-stub-negative-control-20261006.diff`) | **Fail**, as LGP did: `waitForTurnComplete: turn 1 did not complete within 90000ms (reason=surface-missing …)` on both attempts. The outer request now advertises `[generate_a2ui, render_a2ui]` (user prevails: no injection). The stub's error returns to the model as the tool result `"Error: RuntimeError - generate_a2ui called directly"`, and no surface renders. |
| GREEN again after `git checkout` (`strands-d6-a2ui-green2-20261006.log`)                                           | **Pass, 13.3 s**, with the same 12-request flow.                                                                                                                                                                                                                                                                                                                          |

- **A first GREEN attempt was discarded.** It omitted the per-fixture `chunkSize: 9999` from the copied fixtures. It still passed, but slowly (63 s), because each large inner answer streamed in 8-character chunks. The set now keeps those options; the discarded log is in the session scratchpad.
- **No Strands change was needed.**

### (d) Voice and multimodal

See §4: both pass in both full runs.

### (e) HITL guide vs the `/interrupt` agent (`strands-interrupt-probe.mjs`, `strands-interrupt-probe-20261006.log`)

The probe drove the running runtime: `/api/copilotkit`, agent `gen-ui-interrupt`, mapped to `AGENT_URL/interrupt/`, with the shipped strict fixtures.

| Guide claim (`showcase/integrations/strands/docs/setup/human-in-the-loop-setup.mdx`) | On the wire                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tool(context=True)` + `tool_context.interrupt(name, reason=...)` halts the loop    | Run 1 streams the `schedule_meeting` tool call, then stops.                                                                                                                                                                                                                              |
| The run finishes with `RUN_FINISHED` carrying `outcome.type == "interrupt"`          | **Yes**: `{"type":"interrupt","interrupts":[{"id":"v1:tool_call:call_d6_schedule_sales_001:…","reason":"schedule_meeting","metadata":{"reason":{"topic":"Sales intro call","attendee":"Sales team"}}}]}`.                                                                                |
| "hands `reason` to the client as the interrupt payload"                              | **Imprecise.** The interrupt's own `reason` is the interrupt _name_; the tool's `reason` object is `metadata.reason`, which is what the page's `readSchedulingPayload` reads. The sentence was made precise in `602a595fe2`.                                                             |
| The resume arrives wrapped: `{"response": ...}` / `{"cancelled": True}`              | **Yes.** A `resume: [{interruptId, status: "resolved", payload: {chosen_label: "Thu 10:00 AM", …}}]` gives the tool result "Meeting scheduled for Thu 10:00 AM: Sales intro call", then `outcome.type "success"`. `status: "cancelled"` gives "User cancelled. Meeting NOT scheduled …". |
| The interrupt demos' agent names point at the dedicated agent                        | **Yes.** In the `runtime-agent-registration` region, `gen-ui-interrupt` and `interrupt-headless` map to `/interrupt/`. Both cells pass in both runs.                                                                                                                                     |
| A durable resume needs `StrandsAgentConfig.session_manager_provider`                 | The field exists in 0.4.1 (`config.py:248`). This was not exercised.                                                                                                                                                                                                                     |

The shared `useInterrupt.mdx` already says that a standard AG-UI interrupt carries the payload "under `metadata` or JSON-encoded into `message`". The TypeScript sibling's fragment (`strands-typescript`) still has the old sentence. It is outside this run's scope.

### (f) Bring-your-own setup reproduction

See §6.

### (g) Beautiful Chat vs the shared MCP Apps suggestion (REPAIR-036, `d3e97093aa`)

The shared page, byte-identical to ADK's, offers "Excalidraw Diagram (MCP App)", and its header says the runtime enables `mcpApps`. The Strands route did not configure it. The probe is `strands-beautiful-chat-mcp-probe.sh` (`strands-beautiful-chat-mcp-20261006.log`). It sends the suggestion's prompt through `/api/copilotkit-beautiful-chat`, which Strands' own `_from-feature-parity.json` answers with a `create_view` call.

- **BEFORE.** The model request advertised 15 tools, none of them `create_view`. The tool call came back `TOOL_CALL_RESULT "Unknown tool: create_view"`, and no MCP App rendered.
- **Fix.** Add the same `mcpApps` block as the ADK and LGP Beautiful Chat routes (Excalidraw, `serverId: "beautiful_chat_mcp"`). This is a Strands-local route change.
- **AFTER.** The request advertised 16 tools, including `create_view`. The live Excalidraw server returned "Diagram displayed!", and the run emitted `ACTIVITY_SNAPSHOT mcp-apps`, then `RUN_FINISHED`.
- **Coverage.** The D6 `beautiful-chat` expansion does not include this pill. The final full run (A1 11/11, B1 `mcp-apps` 13.2 s) is the regression check.

## 6. Bring-your-own setup reproduction (`/strands/quickstart`, "Use an existing agent")

The scripts are `reproduce-strands-byoc-setup.sh`, `extract-strands-quickstart.py` and `strands-byoc-runtime-run.mts` (`9a738b16f1`). The log is `strands-byoc-setup-20261006.log`, exit 0 for both invocations.

- **Finding the guide.** `strands` resolves to `aws-strands/quickstart.mdx` through `getDocsFolder()`.
- **Tab handling.** The page has `language_strands_agent` tabs (Python and TypeScript) on five steps, plus `package-manager` tabs. The extractor simulates the Tabs component with Python (the `/strands/*` default from `TAB_DEFAULTS_BY_SLUG`) and npm selected, and flags `<Callout>` blocks. The "Using Anthropic instead" callout carries its own `main.py`, which a naive title match would pick.
- **Block count.** The script fails unless visible + hidden equals the option's raw fenced blocks, and every hidden block is in a TypeScript or non-npm tab. The result: **16 + 9 = 25 of 25**.

| Phase                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| visible-path                                    | **PASS**: `uv init my-agent`, `uv add ag-ui-strands "strands-agents[OpenAI]" fastapi uvicorn`, `export OPENAI_API_KEY`, the OpenAI `main.py`, a `[[...slug]]` `HttpAgent` route registering `strands_agent`, a provider `agent="strands_agent" useSingleEndpoint={false}`, and `cd .. / uv run main.py`.                                                                                                                                                                                                                                                                                       |
| Prerequisites ("Python 3.12+")                  | **PASS**: the `uv add` line resolves at `requires-python >=3.12` (ag-ui-strands 0.4.1, ag-ui-protocol 1.0.0, strands-agents 1.57.2, openai 2.54.0, fastapi 0.142.2).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| existing-agent, **as written**                  | **PASS.** uv resolved ag-ui-strands 0.4.1, ag-ui-protocol 1.0.0, ag-ui-a2ui-toolkit 0.0.4, strands-agents 1.57.2, openai 2.54.0, fastapi 0.142.2 and uvicorn 0.54.0 on Python 3.12.6. The guide's start block ran verbatim from `frontend/`, and `openapi.json` returned 200 after 4 s (`POST /`, `GET /ping`). npm gave runtime 1.77.0 and a top-level `@ag-ui/client` **1.0.2**. `info` returned 200 with `strands_agent`. `agent/strands_agent/run` returned 200: `RUN_STARTED … TEXT_MESSAGE_* … RUN_FINISHED` with the fixture's joke. One `gpt-5.4` `system,user` request matched (200). |
| `+ @ag-ui/client@1.0.1` (the runtime's own pin) | **PASS**, with the same event sequence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- **Three AG-UI versions on the as-written install**, as in ADK: 1.0.2 at the top level (the guide's pin), 1.0.1 nested under runtime 1.77.0, and 0.0.59 under `channels-*`. A text run works across them.
- **No guide change was needed.**
- **Not reproduced:**
  - the Next.js scaffold (`npm init -y` stands in for it) and the React files;
  - `npx copilotkit@latest project select` and the Intelligence key (the route ran with the guide's no-Intelligence callout applied);
  - the pnpm, yarn and bun tabs, and the TypeScript tab;
  - the CLI starter path.
- **Bounds.** `UV_EXCLUDE_NEWER` and npm `--before` are both `2026-10-05T21:00Z`, which is after `@ag-ui/client` 1.0.2's 14:21Z publish.

## 7. Docs checks

These ran under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock` at `9a738b16f1`, with the stack stopped:

- `npm run pretypecheck && npm run typecheck`: **pass** (`strands-qual-shell-docs-typecheck-20261006.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (`--maxWorkers=1 --execArgv=--max-old-space-size=4096`): **25/25** (`strands-qual-guard-bindings-20261006.log`).
- `current-v2-authored-guides` + `llm-text`, with the same flags: **2 files, 72/72** (`strands-qual-docs-tests-20261006.log`).
- Generation changed no tracked file. The regenerated (untracked) `setup-content.json` carries the new HITL sentence for `strands`.

## Commits

| SHA          | Subject                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `f60140043a` | chore(showcase): update Strands to CopilotKit 1.77.0 and AG-UI 1.0              |
| `7a25baa55b` | fix(showcase): start the Strands agent from src/ in npm run dev                 |
| `96eb243ad2` | fix(showcase): make the Strands smoke route fail on run errors                  |
| `92a42187ec` | test(showcase): gate the Strands shared-state-read fixture on the edited recipe |
| `d3e97093aa` | fix(showcase): give the Strands Beautiful Chat runtime the MCP Apps server      |
| `602a595fe2` | docs(showcase): say where the Strands interrupt reason reaches the client       |
| `9a738b16f1` | test(audit): reproduce the Strands quickstart's bring-your-own setup            |

This record, its scripts and logs are committed after them. **Shared sources: none changed.** Only `showcase/integrations/strands/**`, `showcase/aimock/d6/strands/shared-state-read.json` and `tasks/` changed, so no other integration is affected.

## Upstream and fleet findings (not filed; drafts for a human)

1. **Eight integrations have the same broken `npm run dev`.** ag2, agno, crewai-crews, crewai-conversational-flows, langroid, llamaindex, ms-agent-python and pydantic-ai run `PYTHONPATH=. python -m uvicorn agent_server:app` from the root, while `agent_server.py` is in `src/`. The fix is the same one-line change as `7a25baa55b`.
2. **`ag_ui_strands` 0.4.1 deprecates implicit wildcard CORS** in `create_strands_app`. That means 10 `FutureWarning`s per showcase boot. A future release will drop the default, so the showcase should pass explicit `origins` or `cors_enabled=False` before then.
3. **`@copilotkit/runtime` 1.77.0 pulls two AG-UI versions:** `channels-*` 0.11.x pins 0.0.59. This is unchanged from the LGTS, LGP and ADK records, and Strands needs the same overrides.
4. **Context-free inner A2UI fixtures.** Strands' inner `render_a2ui` calls are answered by the first identical context-free fixture (ag2's loads first), as in ADK. Strands' outer call never advertises `render_a2ui`, so this hides nothing here. It remains the fleet hazard the LGP record describes.

## Remaining defects and notes

1. **`validate-pins` is red**: 53 FAILs against a baseline of 26 (47 before this run, +6 for Strands). The canonical pin is still 1.68.2.
2. **Not exercised:**
   - `declarative-json-render` (routed only);
   - the legacy `/demos/hitl` page;
   - `shared-state-streaming` (`not_supported_features`: the Strands bridges emit snapshots, not deltas);
   - the Beautiful Chat MCP pill, which D6 does not cover (it was checked by the probe in §5g).
3. **`@copilotkit/react-ui` is pinned but unused** in `src/`.
4. **The Dojo source is stale.** `examples/integrations/strands-python/agent/pyproject.toml` still pins ag_ui_strands 0.1.9, strands-agents 1.18.0 and ag-ui-protocol 0.1.18. The showcase is ahead of its "pin to Dojo" reference.
5. **Carried over.** The OpenTelemetry `Failed to detach context` tracebacks are non-fatal. The Docker build floats `fastapi`, `uvicorn` and `python-dotenv`. The `strands-typescript` HITL fragment keeps the imprecise sentence.

## Resources

- **Load.** Every heavy step ran under `nice -n 10`, one stack at a time, behind a wait-for-load gate (≤ 15) that never had to wait. The maximum sampled 1-minute load was **13.88**, during final B3. `uptime` never read above 16 before a heavy step.
- **RSS** was sampled every 2 s over the descendants of AIMock, each stack boot, each runner (with Playwright's Chromium) and the scratch AIMock (`strands-rss-20261006.log`, `strands-rss-sampler-20261006.sh`, abort line 10.5 GB). `next build`, the setup reproduction and the docs checks ran after the sampler stopped, with no stack up.

  | Phase                                 | Peak (sum of RSS)                       | Largest process       |
  | ------------------------------------- | --------------------------------------- | --------------------- |
  | Boot 1 + all-41-pages pre-warm        | **8,803,616 KiB = 9.01 GB**             | `next-server` 8.14 GB |
  | First run A1 / A2 / B1 / B2 / B3      | 8.15 / 8.28 / 7.66 / 6.95 / 7.68 GB     | `next-server` 5.67 GB |
  | `shared-state-read` red/green         | 7.06 GB                                 | `next-server` 4.51 GB |
  | A2UI order check and negative control | 5.35 GB                                 | `next-server` 3.65 GB |
  | Interrupt and MCP probes              | 5.35 GB                                 | `next-server` 3.64 GB |
  | Final run A1 / A2 / B1 / B2 / B3      | 8.06 / **8.63** / 7.29 / 7.03 / 7.73 GB | `next-server` 6.04 GB |

  The figure sums RSS, so shared Chromium pages are counted more than once. The abort line never fired.

## Limitations

- **AIMock replay is not a live provider.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures. It does not prove model quality or real OpenAI behaviour.
  - The A2UI order proof stands in for a live model with a prompt-gated scratch fixture set.
  - `voice` covers the bundled transcript handoff, not real transcription: `OPENAI_TRANSCRIPTION_API_KEY` was unset, so `/transcribe` is not exercised. `multimodal` covers the sample buttons.
- **Host-native, not Docker.** The stack ran on host Node 22.16.0 and a uv venv on CPython 3.12.6. The image's Python 3.12.13, `pip install`, `entrypoint.sh` and `next start` were not booted. The Docker path was checked only by a host `next build` and `npm ci --legacy-peer-deps`.
- **MCP Apps needs a live external server.** `mcp-apps` and the Beautiful Chat probe discover `create_view` from `https://mcp.excalidraw.com/mcp` even under strict replay, so those checks are not hermetic.
- **The matrix is five runner processes on five boots**, forced by the RSS cap. That is why `hitl-text-input` ran twice.
- **The setup reproduction proves only the agent and the guide's route,** with one text run on Python 3.12. The frontend, the Intelligence path, the TypeScript tab and the other package-manager tabs were not reproduced.

## Cleanup

- **Stopped.** Every stack boot (the `npm run dev` process group), AIMock (:4410, both instances) and the scratch A2UI AIMock (:4411) were stopped with SIGTERM to their own process groups. The RSS sampler was stopped, and every runner exited on its own.
- **The setup script cleaned up after itself.** It stopped its agents and its scratch AIMock (`port 8000 after stop: free`) and removed its `/private/tmp/strands-byoc-setup.*` directories. The `validate-pins` archive and the lock probe were removed.
- **Ports.** 3112, 4410, 4411, 4412 and 8000 are free, and port 3000 was never touched. No `uvicorn`, `llmock`, `run-local-d6` or runner-owned Chromium process remains.
- **Left in place.** The ignored `.next/` and the regenerated `node_modules/` in `showcase/integrations/strands`. The venv, the pytest target, the scratch fixture copy and the discarded first A2UI GREEN log are in the session scratchpad.
