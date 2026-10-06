# LangGraph Python: requalification on published CopilotKit 1.77.0 and AG-UI 1.0 (2026-10-06)

**Verdict: qualified, 40 of 40.** The first full strict D6 run passed **40 of 40** (raw and published), every check on its first attempt, with all 133 AIMock requests answered 200. Nothing needed a rerun.

The recheck of the A2UI dynamic cell found a real defect that strict replay hid, and it was fixed in two commits:

- **`generate_a2ui` was a stub that raises.** `a2ui_dynamic.py` registered a backend `generate_a2ui` that raises `RuntimeError`. That stub stopped `CopilotKitMiddleware` from injecting the real one. A model that follows the agent's own system prompt calls `generate_a2ui`, and the run fails.
- **The subagent calls lost their headers.** After the stub was removed, the middleware's `render_a2ui` subagent calls went out without the forwarded `x-aimock-*` / `x-test-id` headers.

A final full run on fresh boots, at `65e91cc7e4`, passed **40 of 40**. All 141 requests returned 200, and every one carries `x-aimock-context` and `x-aimock-strict`.

|                                  | Result                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First run (raw / published)      | **40/40 / 40/40** at `a11a368c5c`. 0 feature retries; 133 requests, all 200, 0 strict 503s, 0 `developer` messages.                                                                                                                                                      |
| Final run (raw / published)      | **40/40 / 40/40** at `65e91cc7e4`. 0 feature retries; 141 requests, all 200; 141/141 carry `x-aimock-context` + `x-aimock-strict`.                                                                                                                                       |
| `shared-state-read` (mandatory)  | Green in both runs. Both turns are gated on **"Lemon Saffron Orzo"** in a `system` message (`gpt-5.4`, `system,user…`). **RED** on the pre-`d9467aa407` routing: 12 strict 503s. **GREEN** in 14.9 s, plus 3 neighbours green.                                           |
| `gen-ui-declarative` A2UI defect | **RED**: when the model calls `generate_a2ui` as its prompt says, the stub raises and the cell fails. **GREEN** after `1b47fc3db4`: 3-call flow. Headers: **RED** 4 inner calls with no `x-*` → **GREEN** 0 after `65e91cc7e4`. Neighbours 10/10 and 5/5.                |
| `langchain-openai` 1.6.7 checks  | `gpt-5.4`, `gpt-5`, `gpt-5-mini`, `gpt-4o` and `gpt-4o-mini` send `system` (only `o3-mini` gets `developer`). A role-less first chunk is still parsed as `AIMessageChunk`, and its `create_view` tool call survives.                                                     |
| Static checks                    | `compileall`, 29/29 graphs imported, `uv pip check` (103), `next build` and the four validators all pass. `validate-pins` is red at 47 → 47 (the hash changes).                                                                                                          |
| Bring-your-own setup             | **RED**: the 09-23 extractor found only `uv init`, so both tabs failed. The script and extractor were rewritten. **GREEN**: both tabs pass `visible-path` and `existing-agent`, including `RUN_FINISHED` through the guide's own `route.ts`. No guide change was needed. |
| Docs checks (under the lock)     | pretypecheck and typecheck pass; guard 25/25; `current-v2-authored-guides` + `llm-text` 72/72.                                                                                                                                                                           |
| Peak audit RSS                   | **9.12 GB** (8,904,016 KiB), in final batch A2. Under the 11 GB cap; the sampler's 10.5 GB abort line never fired.                                                                                                                                                       |

## Provenance

- **Worktree:** `tyler/docs-feature-audit`. `git pull --ff-only` was a no-op at `a7ddeedac6`, and the tree was clean.
- **CopilotKit is unpatched and registry-published** (`lgp-copilotkit-provenance-20261006.log`).
  - **JS:** all 26 `@copilotkit/*` and `@ag-ui/*` lock entries resolve from `registry.npmjs.org`, and each one's lock integrity equals the registry's `dist.integrity`. The lock has no `link:`, `file:` or git sources.
  - **Python:** `copilotkit` 0.1.96, `ag-ui-langgraph` 0.0.46, `ag-ui-protocol` 1.0.0 and the LangGraph packages were installed by uv from `https://pypi.org/simple`, with no `direct_url`.
- **Toolchain.**
  - The UI lock was generated with Node v24.11.0 / npm 11.6.1, as on 09-23 and in the LGTS run.
  - `npm ci`, the stack, the runner, `next build` and the setup reproduction ran on Node v22.16.0 / npm 10.9.2.
  - Python is a uv venv on host CPython 3.12.6; the Dockerfile uses 3.12.13. uv is 0.11.7, and `@copilotkit/aimock` is 1.37.4.
- **One stack at a time.** Only this stack, its AIMock and the scratch processes listed below ran. Port 3000 was never touched.

## 1. Dependencies

### Python (`requirements.txt`, `lgp-python-install-20261006.log`)

Resolved with `uv pip install -r requirements.txt --exclude-newer 2026-10-05T21:00:00Z --index-url https://pypi.org/simple` at 21:42Z.

- **All 103 resolved packages were dated individually** (`lgp-python-resolution-20261006.json`): **0 violations**. The youngest is `langgraph` 1.2.13, at 27.8 h.
- **`uv pip check`:** all 103 compatible.
- **Every direct target is at least 24 h old.** The PyPI survey is in `lgp-python-resolution-20261006.json`.

| Package                | Before (09-23) | After      | Published (UTC)  | Newer, held back by the bound |
| ---------------------- | -------------- | ---------- | ---------------- | ----------------------------- |
| `ag-ui-protocol`       | 0.1.22         | **1.0.0**  | 2026-09-17 18:31 | none                          |
| `ag-ui-langgraph`      | 0.0.45         | **0.0.46** | 2026-10-01 16:21 | none                          |
| `copilotkit`           | 0.1.96         | 0.1.96     | 2026-08-26 22:31 | none                          |
| `langchain`            | 1.4.2          | **1.4.3**  | 2026-09-28 20:17 | none                          |
| `langchain-openai`     | 1.6.4          | **1.6.7**  | 2026-09-30 15:12 | none                          |
| `langchain-anthropic`  | 1.7.3          | **1.7.5**  | 2026-09-29 15:22 | none                          |
| `langgraph`            | 1.2.12         | **1.2.13** | 2026-10-05 17:51 | 1.2.14 (10-06 14:41)          |
| `langgraph-api`        | 0.14.3         | **0.15.1** | 2026-09-25 17:47 | none (needs Python ≥ 3.11)    |
| `langgraph-cli[inmem]` | 0.4.31         | **0.4.32** | 2026-09-23 18:02 | none                          |
| `langsmith`            | 0.14.0         | **0.14.4** | 2026-10-02 17:16 | none                          |
| `deepagents`           | 0.7.17         | **0.7.22** | 2026-10-05 14:07 | none                          |
| `openai`               | 3.18.0         | **3.24.0** | 2026-10-02 15:55 | 3.25.0, 3.26.0 (10-06)        |

**Transitive packages.** The key ones are:

- `langchain-core` **1.6.6** (09-29), which meets deepagents 0.7.22's `>=1.6.6`. The bound excludes 1.6.7 (10-06).
- `langgraph-runtime-inmem` 0.35.1, `langgraph-sdk` 0.4.5, `langgraph-checkpoint` 4.2.0 and `langgraph-prebuilt` 1.1.0.
- `anthropic` 1.11.0, `ag-ui-a2ui-toolkit` 0.0.4 and `google-genai` 2.28.0.

The `ag-ui-protocol` comment now says AG-UI 1.0 is supported. Two comments name a requirement: one for langgraph-api's Python floor and one for deepagents' `langchain-core` floor.

### JS (`package.json`, `package-lock.json`)

- **`package.json`.**
  - Every `@copilotkit/*` pin goes to exactly **1.77.0** (a2ui-renderer, react-core, runtime, shared, voice).
  - `next` goes to `^15.5.27`.
  - `@ag-ui/client` and `@ag-ui/core` overrides are added at **1.0.1**.
- **The overrides are needed.** A probe resolution without them (same command, temp copy) left **0.0.59** copies of `@ag-ui/core` and `@ag-ui/client` under `@copilotkit/channels-core`, `-intelligence`, `-slack` and `-teams`. Their 0.11.0 pins 0.0.59 exactly. This is the same finding as LGTS.
- **The lock was generated fresh:** `rm -rf node_modules package-lock.json && npm install --package-lock-only --legacy-peer-deps --before=2026-10-05T12:00:00Z` (`lgp-ui-lock-update-20261006.log`). The bound is the LGTS one, and it excludes `@ag-ui/*` 1.0.2.
- **Age audit (`lgp-ui-lock-age-audit-20261006.json`, script `lgts-lock-age-audit.mjs`).** 109 entries were added or changed: **0 violations**, 0 exotic sources. The youngest is `@modelcontextprotocol/sdk` 1.32.1, at 33.9 h.
- **`npm ci --legacy-peer-deps`** (the Dockerfile command) added 867 packages, exit 0 (`lgp-ui-npm-ci-20261006.log`).
- **Duplicate copies (`lgp-dependency-tree-20261006.log`).** Each of these has exactly **one** copy, and `npm ls` shows every channels-\* edge as deduped to 1.0.1:
  - `@copilotkit/core` and `shared` 1.77.0;
  - `@ag-ui/core`, `client`, `encoder` and `proto` 1.0.1;
  - `@ag-ui/langgraph` 0.0.44;
  - `@langchain/core` 1.2.14 and `@langchain/langgraph-sdk` 1.12.1;
  - `next` 15.5.27, and `react` / `react-dom` 19.3.0.

## 2. Static checks (what Showcase CI runs for this integration)

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileall -f src/agents tools _shared`                                                                | **Pass** (`lgp-python-static-20261006.log`).                                                                                                                                                                                                                                        |
| Import every `langgraph.json` graph the way langgraph-api does (`lgp-import-graphs.py`)                 | **29/29**, and again after both fixes (`lgp-a2ui-fix-static-20261006.log`).                                                                                                                                                                                                         |
| `uv pip check`                                                                                          | **Pass**, 103 packages.                                                                                                                                                                                                                                                             |
| Informational: pytest `tests/` + `src/agents/test_a2ui_internal_tools.py`                               | **10/10**, before and after both fixes. pytest was installed to a separate `--target` dir, so the venv is the requirement set only. CI's `python-unit-tests` collects `tests/python/` only, which LGP lacks.                                                                        |
| `ruff format --check` on the changed `.py`                                                              | **Pass** (local ruff 0.16.0; CI pins 0.15.13).                                                                                                                                                                                                                                      |
| `next build`                                                                                            | **Pass**. Next 15.5.27, 57 static pages, 34.5 s, max RSS 3.13 GB. The warnings are the known hashbrown and `@copilotkit/runtime` `channel-manager.mjs` `Critical dependency` lines and the workspace-root warning (`lgp-ui-next-build-20261006.log`).                               |
| `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends`, `validate-fixture-tool-surface` | **Pass**. LGP has 39 demos, 39 specs and 40 QA files, with 3 pre-existing warnings (`lgp-ci-validators-20261006.log`).                                                                                                                                                              |
| `validate-pins` ratchet                                                                                 | **Red before and after, not fixed.** FAIL count **47 → 47**, WARN 2 → 2; the baseline is 26. LGP's five `@copilotkit/*` lines change from 1.73.3 to 1.77.0 against the canonical 1.68.2, so the FAIL hash changes. The pre-update count comes from a `git archive` of `a7ddeedac6`. |

## 3. Boot (documented default command, strict AIMock)

- **AIMock.** The 09-23 command and flags (`--strict --validate-on-load --chunk-size 8 --latency 60`, `AIMOCK_STRICT_TURN_INDEX=1`, no record, proxy or provider flags). It loaded **9056** fixtures (`lgp-aimock-20261006.log`).
- **Stack.** The documented `npm run dev`: `next dev --turbopack` plus `python -u -m langgraph_cli dev … --port 8123`, with the venv first on `PATH`, on port 3100, in the 09-23 environment (`lgp-stack-20261006.sh`, `lgp-dev-stack-20261006.log`).
  - `.next` and the 09-23 `.langgraph_api` store were moved aside first. Every later boot removes both.
  - It was up in 9 s, with **29 graphs**.
  - The agent reports `langgraph-api=0.15.1`, `in-memory runtime=0.35.1` and `langgraph_py_version` 1.2.13. Runtime `info` reports **1.77.0** with 31 agents.
- **Pre-warm.** All 41 demo pages return 200. The API status codes match 09-23 (`lgp-prewarm-20261006.log`).
- **`/api/smoke`.** 200 `ok` in 1.6 s, through a real AG-UI 1.0 run to `RUN_FINISHED`, with one request (200) (`lgp-smoke-route-20261006.log`).

## 4. Full strict D6 matrix

The runner command is the 09-23 one, with `--demos <batch>`:

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-python --demos <batch>
```

- **Batching.** The RSS cap rules out one boot: on 09-23, one boot peaked at 12.95 GB, and this run's all-pages pre-warm alone reached 8.21 GB. The matrix therefore ran as the five LGTS batches.
- **Each batch** ran as one runner at `FEATURE_CONCURRENCY_D6=4`, on its own fresh boot: `.next` and `.langgraph_api` removed, the batch's pages and every API route pre-warmed, and the AIMock journal reset.
- **Per-feature results** are in `lgp-runtime-matrix-20261006.json`.

| Batch | Features                                                                                                                | Checks | First run (`a11a368c5c`) | Final run (`65e91cc7e4`) |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------ | ------------------------ |
| A1    | `beautiful-chat` … `headless-simple`                                                                                    | 11     | 11/11, 40.9 s, 17 req    | 11/11, 40.1 s, 17 req    |
| A2    | `headless-complete` … `declarative-gen-ui`, `a2ui-fixed-schema`, `a2ui-recovery`                                        | 11     | 11/11, 46.2 s, 39 req    | 11/11, 48.1 s, 47 req    |
| B1    | `mcp-apps`, `gen-ui-agent`, `tool-rendering-default-catchall`, `-custom-catchall`, `tool-rendering`, `-reasoning-chain` | 6      | 6/6, 37.3 s, 43 req      | 6/6, 37.0 s, 43 req      |
| B2    | `shared-state-read`, `-read-write`, `-streaming`, `readonly-state-agent-context`, `subagents`, `multimodal`             | 6      | 6/6, 44.1 s, 21 req      | 6/6, 44.5 s, 21 req      |
| B3    | `auth`, `declarative-hashbrown`, `declarative-json-render`, `open-gen-ui`, `-advanced`, `voice`, `agent-config`         | 6      | 6/6, 61.9 s, 13 req      | 6/6, 61.6 s, 13 req      |

|                   | Checks | First run | Final run |
| ----------------- | ------ | --------- | --------- |
| Raw matrix        | 40     | **40**    | **40**    |
| Published catalog | 40     | **40**    | **40**    |

- **Failures and reruns.** There were none in the first run: 0 `feature-retry` events, so nothing was rerun.
- **Intermediate run.** A full run at `1b47fc3db4` (stub removed, header fix not yet in) also passed 40/40, with 141 requests, all 200 (`lgp-*-postfix1-*`).
- **Mapping** is unchanged from `d6-lgp-count-reconciliation.md`.
  - There are 38 manifest features, and `cli-start` has no D6 type. `beautiful-chat` expands into 5 checks.
  - `declarative-hashbrown` and `declarative-json-render` fold into `byoc`, which navigates only to `declarative-hashbrown`, so **`declarative-json-render` is routed but not directly exercised**.
  - All 40 checks map to shipped demos.
- **Policy-excluded and untested:** `gen-ui-interrupt` and `interrupt-headless` (`not_supported_features`).
- **Journals** (`lgp-d6-journal-{full,final}-*-20261006.json`).
  - First run: 133 requests, 121 to Chat Completions and 12 to `/v1/responses`. Every request carries `x-aimock-context: langgraph-python` and `x-aimock-strict: true`, and there are 0 `developer` messages.
  - Final run: 141 requests, all 200, all with both headers. The 8 extra requests are the 3-call A2UI flow.
  - 4 Chat Completions responses per run come from fixtures that carry `reasoning`, all in the reasoning cells. LangGraph Python tolerates them (see §5).
- **Stack logs.** The matrix logs show only two non-fatal Next errors, both in passing batches: an `ECONNRESET` in first-run B3, as `agent-config` ended, and `unhandledRejection: Unexpected end of JSON input` in final A1, as four `beautiful-chat` contexts loaded (LGTS saw the same).

## 5. The rechecks asked for

### `shared-state-read`: green and gated on both turns

- **Full runs.** The cell passed in both full runs (37.6 s and 16.4 s), on its first attempt.
  - Both turns went out as `gpt-5.4` with roles `system,user` and `system,user,assistant,user`.
  - Both system prompts contain **"Lemon Saffron Orzo"**, and they matched the two gated fixtures (`systemMessage: "Lemon Saffron Orzo"`, turn 1 with `turnIndex: 0`), both 200.
  - A capture of the full request bodies through a byte-for-byte proxy (`lgts-capture-proxy-20261006.mjs` on :4412, diagnostic boot `lgp-*-diag-capture-20261006.*`) confirms "Lemon Saffron Orzo" sits in a `system` message on both turns.
- **RED (`lgp-d6-redgreen-ssr-red-20261006.log`, journal alongside).**
  - The 09-23 revert of `d9467aa407` was applied to `route.ts` (`lgp-shared-state-read-red-revert-20261006.diff`). It maps the cell to the neutral `sample_agent` and was not committed.
  - Fresh boot, `--demo shared-state-read`: **fail**, `waitForTurnComplete: turn 1 did not complete within 55698ms (reason=dom-missing …)` on both attempts.
  - 12 requests, all `system` "You are a helpful, concise assistant.", **all 12 → 503**.
- **GREEN (`lgp-d6-redgreen-ssr-green-neighbours-20261006.log`).** `route.ts` was restored, which `git status` confirmed. On a fresh boot:
  - `shared-state-read` passed in 14.9 s, with both gated fixtures matched;
  - its neighbours passed too: `shared-state-write` 15.4 s, `readonly-state-context` 8.4 s and `shared-state-streaming` 20.2 s;
  - 12 requests, all 200, 0 retries.

### `langchain-openai` 1.6.7 (`lgp-langchain-openai-checks-20261006.py` / `.log`)

These ran against the live strict AIMock, with the stack's venv: `langchain-openai` 1.6.7, `langchain-core` 1.6.6 and `openai` 3.24.0.

1. **`developer` vs `system`: still `system` for every model this integration uses.**
   - `ChatOpenAI` rewrites `system` to `developer` only for `^o\d` models: `gpt-5.4`, `gpt-5`, `gpt-5-mini`, `gpt-4o` and `gpt-4o-mini` all send `system,user`, and `o3-mini` sends `developer,user`.
   - Every LGP graph uses `gpt-5.4`, `gpt-4o` or `gpt-4o-mini`.
   - Both journals have **0** `developer` messages.
   - Unlike LGTS's JS client, the Python client sends gpt-5 system prompts as `system`. AIMock's missing `developer` mapping therefore does not affect LangGraph Python.
2. **A role-less first stream chunk is still an assistant message.**
   - The `create_view` fixture's first SSE delta is `{reasoning_content}` with **no `role`**. Through `ChatOpenAI` it aggregates to an `AIMessageChunk` with `tool_calls == ["create_view"]`.
   - `_convert_delta_to_message_chunk` maps role-less `reasoning_content`, `content` and `tool_calls` deltas to `AIMessageChunk`. Both stream paths still start from `default_chunk_class = AIMessageChunk`.

### `mcp-apps`

Passed in both runs (7.7 s and 7.5 s). The capture shows the agent's request with `tools: [create_view]`, discovered from the live `https://mcp.excalidraw.com/mcp`, as `gpt-5.4` `system,user`, with all forwarded headers.

### A2UI: `gen-ui-declarative` (dynamic schema)

**Background.** In 1.77.0, `sdk-js` hands TypeScript agents `generate_a2ui` instead of `render_a2ui`. LangGraph Python does not use `sdk-js`. The Python equivalent is `copilotkit` 0.1.96's `CopilotKitMiddleware`, and it behaves the same way: when `state["ag-ui"]["inject_a2ui_tool"]` is set, it injects its own `generate_a2ui` (a `render_a2ui` subagent bound to the agent's model) and drops the runtime's frontend `render_a2ui`. `ag-ui-langgraph` 0.0.46 surfaces that flag from `forwardedProps.injectA2UITool`.

**What the first run actually exercised (full request bodies captured through the proxy: `lgp-capture-diag-20261006.jsonl`; journal `lgp-d6-journal-diag-capture-20261006.json`).**

- The outer agent request (`gpt-4o`, about 78 KB) listed **both** `generate_a2ui` and `render_a2ui`.
- The middleware skips injection when the agent already defines a tool of the same name ("no double-inject"). `a2ui_dynamic.py` defined one: a backend `generate_a2ui` stub, added in `e57ea6b864`, that raises `RuntimeError("generate_a2ui called directly …")` on the belief that the runtime intercepts it. Nothing intercepts it.
- Under strict replay, the context-free inner fixture `{userMessage, toolName: "render_a2ui"}` matched the outer call first. Nine integrations' d6 directories carry an identical one (ag2's loads first). The agent then emitted `render_a2ui` directly, so each pill was a single request.
- That is also how the cell passed on 09-23 (same journal pattern). LangGraph Python's own `generate_a2ui` → inner `render_a2ui` → `toolCallId` follow-up fixtures were never reached.

**RED: the run fails when the model follows its prompt.**

- **Setup.** A scratch strict AIMock on :4411 held `lgp-a2ui-live-order-fixtures-20261006.json`: the same responses as LangGraph Python's `gen-ui-declarative.json`, reordered so the outer call is answered as the system prompt instructs (gated on that prompt's text, returning `generate_a2ui`). The stack's `OPENAI_BASE_URL` pointed there, and the runner and probe were the same (`lgp-d6-a2ui-live-red-20261006.log`).
- **Result.** At `a11a368c5c`, with the stub still present: **fail**, `waitForTurnComplete: turn 1 did not complete … (reason=dom-missing …)`.
- **Stack log.** `Run encountered an error in graph: <class 'RuntimeError'>(generate_a2ui called directly — …)`, 4 times.

**Fix 1 (`1b47fc3db4`).** Remove the stub (`tools=[]`) and replace its docstring with a comment saying why there is none. This is what `02b11c985d` ("agents collapse to create_agent + CopilotKitMiddleware with no hand-rolled tool") intended.

**GREEN (same scratch AIMock and runner, `lgp-d6-a2ui-live-green-20261006.log`).** **Pass**, 17.8 s. 12 requests: per pill, outer `generate_a2ui`, inner `render_a2ui` (the toolkit subagent's own system prompt), then the outer `toolCallId` follow-up.

**On the shipped fixtures (`lgp-d6-green-a2ui-neighbours-20261006.log`).**

- `gen-ui-declarative` now runs the 3-call flow the LGP fixtures describe, with no fixture change.
- Neighbours passed on the same boot, 10/10 with 0 retries: `gen-ui-a2ui-fixed`, `a2ui-recovery`, `byoc`, 5 × `beautiful-chat` and `agentic-chat`.
- **One regression in the evidence.** The 4 inner `render_a2ui` calls carried **no** `x-aimock-strict`, `x-aimock-context` or `x-test-id`. Each is still matched by a context-free inner fixture, but a deployed AIMock would proxy a miss to the real provider. This violates the checklist's per-request forwarding rule.

**Root cause of the header loss, and fix 2 (`65e91cc7e4`).**

- `CopilotKitMiddleware` sets the forwarded-header ContextVar only in `wrap_model_call`. The subagent calls the model from the tool node, where that value is gone.
- LGP already has `AuxiliaryModelHeaderForwardingMiddleware`, which re-reads the headers at the tool boundary, for exactly this case in `recovery_agent.py`. `a2ui_dynamic.py` now adds it for its own model.
- **GREEN** (`lgp-d6-green-a2ui-headers-20261006.log`): 5/5 (`gen-ui-declarative`, `a2ui-recovery`, `gen-ui-a2ui-fixed`, `byoc`, `agentic-chat`). 27 requests, **0 without `x-aimock-context`**, against 4 of 36 before.
- **Final full run:** 141/141 requests carry both headers.

**Other integrations.** No shared source, probe or fixture changed. The underlying middleware behaviour is upstream (see Upstream findings).

## 6. Bring-your-own setup reproduction (`/langgraph-python/quickstart`, "Use an existing agent")

The scripts are `reproduce-lgp-byoc-setup.sh` and `extract-lgp-quickstart-python.py` (both rewritten), with `lgts-byoc-runtime-run.mts` (reused unchanged).

| Run                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RED: the 09-23 script, unchanged (`lgp-byoc-setup-red-20261006.log`) | The extractor finds **1 block** (`uv init my-agent`). Both tabs **FAIL** at "Install LangGraph": "no LangSmith/FastAPI block matching starts=uv add langgraph". The cause is the per-step language tabs (09-30, `5895f8030c`) and `7256775c4c`: the first-Python-tab-to-next-TypeScript-tab region now holds only `uv init`.                                                                                                                                                                     |
| Rewrite                                                              | The extractor now simulates the docs Tabs component, as the LGTS one does: Python pre-selected (`TAB_DEFAULTS_BY_SLUG`), the deployment tab as an argument (LangSmith is the `/langgraph-python` default and FastAPI the `/langgraph-fastapi` default), and npm. The script runs, per tab, a `visible-path` check and an `existing-agent` phase with the guide's own blocks. The start block now runs **verbatim** from `frontend/`, because the guide's `cd ..` returns to the agent directory. |
| GREEN (`lgp-byoc-setup-20261006.log`), exit 0                        | **LangSmith:** `visible-path` PASS (17 visible blocks; main.py, langgraph.json, a `LangGraphAgent` route and `npx @langchain/langgraph-cli dev`). `existing-agent` PASS: langgraph 1.2.13, langchain-openai 1.6.7, langchain-core 1.6.6; `/ok` 200 in 8 s; langgraph-api 0.15.1; runtime 1.77.0 `info` 200 with `sample_agent`; `agent/run` 200 → `RUN_STARTED … TEXT_MESSAGE_* … RUN_FINISHED` with the fixture's joke; one `gpt-4.1-mini` `system,user` request (200).                         |
|                                                                      | **FastAPI:** `visible-path` PASS (16 visible blocks; both `uv add` lines, main.py, an `HttpAgent` route and `uv run main.py`). `existing-agent` PASS: ag-ui-langgraph 0.0.46, **ag-ui-protocol 1.0.0**, copilotkit 0.1.96, fastapi 0.142.2, uvicorn 0.54.0; `/health` 200 in 5 s; the same `info` and `agent/run` result, ending in `RUN_FINISHED`.                                                                                                                                              |

- **No guide change was needed.** Both tabs work as written, through the guide's own `route.ts` (with the no-Intelligence callout applied) and the provider's `agent="sample_agent"`. That callout and the `npx copilotkit@latest project select` Intelligence step were not reproduced.
- **Two AG-UI versions on the plain install.** The guide's `npm install @copilotkit/react-core @copilotkit/runtime` installs 15 × `@ag-ui/core@0.0.59` (via `channels-*`) and 7 × 1.0.1. The top-level `@ag-ui/client`, which the FastAPI route imports without installing it, is 1.0.1. The text run works.
- **Bounds.** `UV_EXCLUDE_NEWER=2026-10-05T21:00:00Z` and `npm --before=2026-10-05T12:00:00Z` (including npx and the JS CLI's `uv run --with langgraph-cli[inmem]`).
- **Superseded script.** `check-lgp-byoc-fastapi-agui.sh` / `lgp-byoc-fastapi-run.mjs` (09-23) are superseded by the FastAPI `existing-agent` phase. A header note says so; they read the old extractor's output format.

## 7. Docs checks

These ran under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock` at `65e91cc7e4`, with the stack stopped.

- `npm run pretypecheck && npm run typecheck`: **pass** (`lgp-qual-shell-docs-typecheck-20261006.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (`--maxWorkers=1 --execArgv=--max-old-space-size=4096`): **25/25** (`lgp-qual-guard-bindings-20261006.log`).
- `current-v2-authored-guides` + `llm-text` (same flags): **2 files, 72/72** (`lgp-qual-docs-tests-20261006.log`). Informational: `langgraph-configurable-channels` passes 6/6.
- Generation changed no tracked file.
- **Docs exposure.** `src/agents/a2ui_dynamic.py` is a `declarative-gen-ui` manifest highlight, so the rendered code view now shows the stub-free agent. The quickstart was not edited.

## Commits

| SHA          | Subject                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `a11a368c5c` | chore(showcase): update LangGraph Python to CopilotKit 1.77.0 and AG-UI 1.0                  |
| `1b47fc3db4` | fix(showcase): let CopilotKitMiddleware own generate_a2ui in the LangGraph Python A2UI agent |
| `65e91cc7e4` | fix(showcase): forward request headers to the LangGraph Python A2UI subagent                 |

This record, its scripts and its logs are committed after them. **Shared sources: none changed.** Only `showcase/integrations/langgraph-python/**` and `tasks/` changed, so no other integration is affected.

## Upstream findings (not filed; drafts for a human)

1. **`copilotkit` (Python) 0.1.96: the middleware-injected `generate_a2ui` subagent drops forwarded headers.**
   - `CopilotKitMiddleware.wrap_model_call` calls `_extract_forwarded_headers_from_config()`. `wrap_tool_call` / `awrap_tool_call` do not.
   - The subagent's model calls run in the tool node, through `asyncio.to_thread` + `asyncio.run` in `ag_ui_langgraph/a2ui_tool.py`, so they go out without the inbound `x-*` headers.
   - **Repro:** LangGraph Python at `1b47fc3db4`, `run-local-d6.mts langgraph-python --demo declarative-gen-ui` on strict AIMock. The journal shows 4 inner `render_a2ui` requests with no `x-aimock-*` / `x-test-id`, while the outer calls have them (`lgp-d6-journal-green-a2ui-neighbours-20261006.json`).
   - **Suggested fix:** call `_extract_forwarded_headers_from_config()` at the top of both tool-call wrappers.
   - It also affects LangGraph FastAPI and any Python agent that relies on auto-injection. LGTS has the TypeScript analogue (its record, remaining item 2).
2. **`copilotkit` (Python): "no double-inject" fails silently.** When an agent already defines a tool named `generate_a2ui`, the middleware skips injection without a log line and leaves the runtime's `render_a2ui` advertised. A one-line warning would have exposed the stub.
3. **`@copilotkit/runtime` 1.77.0 pulls two AG-UI versions.** `channels-*` 0.11.x pins `@ag-ui/core`/`client` 0.0.59 exactly. This is unchanged from the LGTS record, and the LGP lock needs the same overrides.
4. **AIMock 1.37.4 does not map `developer` to `system`.** This is unchanged, but does not affect LangGraph Python, whose client sends `system` for every model it uses.

## Remaining defects and notes

1. **`validate-pins` is red**: 47 FAILs against a baseline of 26, with canonical 1.68.2. The count is unchanged; the hash changes.
2. **The context-free inner A2UI fixtures are a fleet-wide hazard.** Nine integrations' d6 directories carry `{userMessage, toolName: "render_a2ui"}` with no `context` for the same four pills: ag2, google-adk, langgraph-fastapi, langgraph-python, langgraph-typescript, mastra, pydantic-ai, strands and strands-typescript. Any outer agent call that still advertises `render_a2ui` matches one first, which is how the LGP stub stayed hidden. Not changed here; it is a shared-fixture decision.
3. **LangGraph FastAPI** (`langgraph-fastapi/src/agents/src/a2ui_dynamic.py`) also defines a `generate_a2ui`. It was not inspected or run here, because it is outside this run's scope.
4. **Carried over from 09-23:** `src/agents/test_agent_config_agent.py` imports a removed name (CI does not collect it); `cmdk@0.2.1`'s peer needs `--legacy-peer-deps`; the Docker build floats Python transitives; `npm run dev` runs the Python server with one job slot.
5. **Not exercised:** `declarative-json-render` (routed only), and `gen-ui-interrupt` / `interrupt-headless` (policy-excluded).

## Resources

- **Load.** Every heavy step ran under `nice -n 10`, and a wait-for-load gate (≤ 16) ran before each boot and each runner. **One slip:** `next build` started when the 1-minute load read **16.14**, which was Spotlight indexing right after `npm ci`. The build passed. The sampler's maximum, 21.25 at 21:51:49Z, came while only AIMock was up; the stack boot waited until the load was 13.0.
- **RSS** was sampled every 2 s over the descendants of AIMock, each stack boot, each runner (with Playwright's Chromium) and the capture proxy (`lgp-rss-20261006.log`, `lgp-rss-sampler-20261006.sh`, abort line 10.5 GB). The setup reproduction and docs checks ran after the sampler stopped, with no stack up.

  | Phase                                           | Peak (sum of RSS)                | Largest process       |
  | ----------------------------------------------- | -------------------------------- | --------------------- |
  | Boot + all-41-pages pre-warm                    | 8,016,240 KiB = 8.21 GB          | `next-server` 7.40 GB |
  | First run A1…B3                                 | 8,305,600 KiB = 8.50 GB (A1)     | `next-server` 6.00 GB |
  | Diagnostic, red/green and intermediate full run | 8,179,952 KiB = 8.38 GB          | `next-server` 5.75 GB |
  | Final run A1…B3                                 | **8,904,016 KiB = 9.12 GB** (A2) | `next-server` 6.38 GB |

  The figure sums RSS, so shared Chromium pages are counted more than once.

## Limitations

- **AIMock replay is not a live provider.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures, not model quality or real-OpenAI behaviour.
  - The A2UI RED stands in for a live model with a reordered scratch fixture set. The claim that a live model calls `generate_a2ui` rests on the agent's own system prompt, not on a live capture.
  - `voice` covers the bundled transcript handoff, and `multimodal` the sample button.
- **Host-native, not Docker.** The stack ran on host Node 22.16.0 and a uv venv on CPython 3.12.6. The image's Python 3.12.13, `pip install`, `entrypoint.sh` flags and `next start` were not booted. The Dockerfile path was checked only by host `next build` and `npm ci --legacy-peer-deps`.
- **MCP Apps needs a live external server.** `mcp-apps` and Beautiful Chat's Excalidraw tools discover `create_view` from `https://mcp.excalidraw.com/mcp` even under strict replay, so those cells are not hermetic.
- **The matrix is five runner processes on five boots**, forced by the RSS cap.
- **The setup reproduction does not cover the frontend.** It proves the agent, the guide's route and one text run per deployment tab. The Next.js scaffold, the React files, the Intelligence path and the pnpm/yarn/bun tabs were not reproduced.

## Cleanup

- Every stack boot (the `npm run dev` process group), AIMock (:4410), the scratch A2UI AIMock (:4411) and the capture proxy (:4412) were stopped with SIGTERM to their own process groups. The RSS sampler was stopped, and every runner exited.
- The setup script stopped its agents and scratch AIMocks itself (`ports 8123/4411 after stop: free/free`) and removed its `/private/tmp/lgp-byoc-setup.*` directories.
- **Ports** 3100, 4410, 4411, 4412, 8123, 8124 and 2024 are free. Port 3000 was never touched. No `langgraph_cli`, `llmock`, `run-local-d6`, capture-proxy or runner-owned Chromium process remains.
- **Other checkouts' processes were not signalled:** `next dev` on 3061 and 3063.
- **Twelve mis-named output files** came from a shell word-splitting slip on the first final-batch attempt. Their runner exited at argument parsing; they were deleted and the batches rerun.
- **Left in place:** in `showcase/integrations/langgraph-python`, the ignored `.next/` and `.langgraph_api/` and the regenerated `node_modules/`. The 09-23 `.langgraph_api` store, the venv and the capture JSONL are in the session scratchpad.
