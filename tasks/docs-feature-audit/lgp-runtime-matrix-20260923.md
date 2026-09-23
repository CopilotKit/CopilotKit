# LangGraph Python: local qualification on published CopilotKit 1.73.3 and current stable Python (2026-09-23)

**Verdict: qualified, 40 of 40.** The full strict D6 matrix passed 40 of 40 checks on its first run. Every check passed on its first attempt, and there were no feature retries. The published-catalog count is also 40 of 40. The first run is also the final result: the only product change after it is `/api/smoke`, and no D6 probe calls that route (see [Final count](#final-count)).

The two quarantined LangGraph interrupt demos, `gen-ui-interrupt` and `interrupt-headless`, are **policy-excluded and untested**. Their manifest quarantine is unchanged, and they do not count as passes.

|                                | Result                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw matrix / published catalog | **40/40** and **40/40**. First run = final. 195.0 s in the driver, 0 feature retries.                                                                                |
| AIMock journal (full run)      | 133 requests, all 200, **0 strict 503s**. All carry `x-aimock-strict: true`. 0 `developer`-role messages.                                                            |
| `shared-state-read` red/green  | **RED** on the pre-`d9467aa407` routing: 12 × strict 503, turn 1 times out. **GREEN** at HEAD in 11.8 s.                                                             |
| Defect found and fixed         | `/api/smoke` returned 200 "ok" on a run that failed before reaching the model (`0828d39b45`). Red/green is below.                                                    |
| Static checks                  | Python compile and import pass (29/29 graphs), as do `uv pip check`, `next build` and the CI validators. The `validate-pins` ratchet was already red on this branch. |
| Bring-your-own Python setup    | **PASS** on both deployment tabs, run as written. No guide change was needed.                                                                                        |
| Docs checks (under the lock)   | pretypecheck and typecheck pass, the guard passes 25/25, and `current-v2-authored-guides` + `llm-text` pass 71/71.                                                   |
| Peak audit RSS                 | **12.06 GiB (12.95 GB)** for about 50 s during the full matrix. That is **above** the 12 GB budget; see [Resources](#resources).                                     |

## Provenance

- **Worktree:** `tyler/docs-feature-audit`.
  - The dependency update is `feb4591dce`. The full matrix and the static checks ran at that HEAD, with the tree clean outside `tasks/`.
  - The red/green and regression runs ran on the same stack. The smoke fix `0828d39b45` came next. The setup reproduction and docs checks ran at `0828d39b45`.
- **No other stack ran.** Only this LangGraph Python stack and its AIMock were up.
- **CopilotKit is unpatched and registry-published.**
  - JS: every `@copilotkit/*` entry is 1.73.3 (or its matching `channels-*` 0.11.0 and `license-verifier` 0.5.0). Each entry resolves from `registry.npmjs.org`, and its lock integrity equals the registry's `dist.integrity`. `npm ci` verified the tarballs against the lock. The lock has no `link:`, `file:` or git sources.
  - Python: `copilotkit` 0.1.96, `ag-ui-langgraph` 0.0.45 and `ag-ui-protocol` 0.1.22 were installed by uv from `https://pypi.org/simple`, with no `direct_url`.
  - Evidence: `lgp-copilotkit-provenance-20260923.log`.
- **Toolchain:**
  - The stack, runner, build and setup reproduction used Node v22.16.0 / npm 10.9.2. The UI lock was generated with Node v24.11.0 / npm 11.6.1, as LGTS did.
  - Python is a uv venv on host CPython 3.12.6. The Dockerfile uses 3.12.13.
  - uv 0.11.7 and `@copilotkit/aimock` 1.37.4.

## 1. Dependencies

### Python (`requirements.txt`)

Resolved with `uv pip install -r requirements.txt --exclude-newer 2026-09-22T23:00:00Z --index-url https://pypi.org/simple` at 2026-09-23T23:01Z. The bound is exactly 24 hours before resolution (`lgp-python-install-20260923.log`).

- Each direct package was re-verified on PyPI. The newest non-prerelease, non-yanked release at or before the bound was taken (`lgp-pypi-survey-20260923.json`).
- All 103 resolved packages were then dated individually (`lgp-python-resolution-20260923.json`): **0 violations**. The youngest is `langchain-openai` 1.6.4, at 24.4 hours.
- `uv pip check`: all 103 packages are compatible.

| Package                | Before  | After      | Published (UTC)  | Age at resolution | Newer releases held back by the bound |
| ---------------------- | ------- | ---------- | ---------------- | ----------------- | ------------------------------------- |
| `langgraph`            | 1.2.11  | **1.2.12** | 2026-09-21 14:43 | 56.3 h            | none                                  |
| `langchain`            | 1.4.0   | **1.4.2**  | 2026-09-18 17:31 | 125.5 h           | none                                  |
| `langchain-openai`     | 1.1.9   | **1.6.4**  | 2026-09-22 22:36 | 24.4 h            | 1.6.5 (09-23 15:31)                   |
| `langchain-anthropic`  | 1.7.2   | **1.7.3**  | 2026-09-22 22:07 | 24.9 h            | 1.7.4 (09-23 17:55)                   |
| `langsmith`            | 0.12.4  | **0.14.0** | 2026-09-21 18:59 | 52.0 h            | none                                  |
| `deepagents`           | 0.7.13  | **0.7.17** | 2026-09-22 04:47 | 42.2 h            | 0.7.18 (09-23 03:06)                  |
| `langgraph-api`        | 0.14.0  | **0.14.3** | 2026-09-18 22:55 | 120.1 h           | 0.14.4 (09-23 01:49)                  |
| `langgraph-cli[inmem]` | 0.4.31  | 0.4.31     | 2026-07-10 22:57 | 1800 h            | 0.4.32 (09-23 18:02)                  |
| `copilotkit`           | 0.1.96  | 0.1.96     | 2026-08-26 22:31 | 672.5 h           | none                                  |
| `ag-ui-langgraph`      | 0.0.45  | 0.0.45     | 2026-09-09 15:22 | 343.6 h           | none                                  |
| `ag-ui-protocol`       | 0.1.22  | 0.1.22     | 2026-08-31 18:20 | 556.7 h           | 1.0.0 exists; kept off it on purpose  |
| `openai`               | 1.109.1 | **3.18.0** | 2026-09-22 18:26 | 28.6 h            | 3.19.0, 3.19.1                        |
| `pypdf` (`>=4,<7`)     | range   | 6.19.0     | 2026-09-16 09:32 | 181.5 h           | none                                  |

Notes:

- **`openai`:** `langchain-openai` 1.6.4 requires `openai>=2.45.0,<4.0.0`, so the old 1.109.1 pin had to go. It is re-pinned exactly to the resolved 3.18.0, keeping the provider-SDK pinning rule (`INTEGRATION-CHECKLIST.md`). No agent module imports `openai` directly.
- **`deepagents` 0.7.17** requires `langchain>=1.4.2`, `langchain-core>=1.6.4`, `langchain-anthropic>=1.7.2` and `langsmith>=0.14.0`. The pins above satisfy all four. It also adds a new transitive dependency, `langchain-google-genai` 4.4.0 (with `google-genai` 2.25.0).
- **`ag-ui-protocol` stays at 0.1.22:** CopilotKit 1.73.3 does not support AG-UI 1.0. `ag-ui-langgraph` 0.0.45 needs `>=0.1.22`. The file now says why.
- **Key transitive packages:** `langchain-core` 1.6.4, `langgraph-runtime-inmem` 0.34.1, `langgraph-sdk` 0.4.5, `langgraph-checkpoint` 4.2.0, `langgraph-prebuilt` 1.1.0, `anthropic` 1.8.0 and `ag-ui-a2ui-toolkit` 0.0.4.

### The two LangGraph TypeScript risk areas, checked explicitly (`lgp-langchain-openai-checks-20260923.log`)

The script is `lgp-langchain-openai-checks.py`, run against the strict AIMock with the LangGraph Python fixtures.

1. **Role-less first stream chunk (the LGTS `mcp-apps` root cause): not an issue here.**
   - Replaying the `create_view` fixture, which carries `reasoning`, to `gpt-5.4` over Chat Completions produces a first SSE delta of `{reasoning_content}` with **no `role`**. That is exactly the shape that broke LangGraph TypeScript.
   - `langchain-openai` 1.6.4 still starts streaming from `default_chunk_class = AIMessageChunk` (`chat_models/base.py`, both stream paths). `_convert_delta_to_message_chunk` returns an `AIMessageChunk` when either `role == "assistant"` or the default class is `AIMessageChunk`.
   - The aggregated message is therefore an `AIMessageChunk` with `tool_calls == ["create_view"]`.
   - In the matrix, the same fixture and the reasoning "weather in Tokyo" fixture both passed (`mcp-apps` in 7.1 s, `tool-rendering` in 9.2 s).
2. **`developer` vs `system`: every gated request uses `system`.**
   - `ChatOpenAI` 1.6.4 rewrites `system` to `developer` only for o-series models (`re.match(r"^o\d", model)`). The payload roles for `gpt-5.4` and `gpt-4o-mini` are `system,user`; `o3-mini` gets `developer,user`.
   - Every LangGraph Python graph uses `gpt-5.4`, `gpt-4o` or `gpt-4o-mini`. `gpt-5.4` is not a Responses-only prefix (only `gpt-5.4-pro` is).
   - The full-run journal has **0** `developer` messages among its non-truncated bodies.
   - Both `shared-state-read` requests went out as `system,user…` with "Lemon Saffron Orzo" in the system prompt. The `systemMessage` gate matched both (red/green below).

### JS (`package.json`, `package-lock.json`)

- **`package.json`:** every `@copilotkit/*` dependency (a2ui-renderer, react-core, runtime, shared, voice) goes to exactly `1.73.3`. The stale `@copilotkit/web-inspector → @copilotkit/core 1.68.2` override is removed in both its npm and pnpm forms. No other range changed.
- **The lock was generated fresh, as LGTS did:** `rm -rf node_modules package-lock.json && npm install --package-lock-only --legacy-peer-deps --before=2026-09-22T23:00:00Z` (`lgp-ui-lock-update-20260923.log`).
  - The first, strict-peer attempt fails with `ERESOLVE`. The cause is the pre-existing `cmdk@0.2.1` dependency: its peer is `react@^18`, and the root depends on React 19.
  - The Dockerfile installs with `npm ci --legacy-peer-deps`. The committed lock was already a legacy-peer lock, with 0 peer-flagged entries. So the lock is generated in that mode.
- **Age audit (`lgp-ui-lock-age-audit-20260923.json`):** all 262 added or changed name@version pairs have publish times at or before the bound, with **0 violations**. The youngest is the first-party `@copilotkit/*` 1.73.3 set, at 25.3 hours, so no `.npmrc` exemption was needed. All 917 entries resolve from `registry.npmjs.org`.
- **Clean install as the Dockerfile does it:** `npm ci --legacy-peer-deps` (npm 10.9.2) added 860 packages with exit 0 (`lgp-ui-npm-ci-20260923.log`).
- **No AG-UI override is needed.** A fresh legacy-peer resolution does not install peers through open ranges, so `@ag-ui/core` and `@ag-ui/client` resolve to a **single 0.0.59 copy** and 1.0.0 never appears. (LGTS needed overrides because its locks resolve peers.)

| Package                                                             | Before (committed lock)         | After                   | Published (UTC)     |
| ------------------------------------------------------------------- | ------------------------------- | ----------------------- | ------------------- |
| `@copilotkit/react-core`, `runtime`, `a2ui-renderer`, `voice`, etc. | 1.68.2                          | **1.73.3**              | 2026-09-22 21:45–48 |
| `@copilotkit/core` / `shared`                                       | 1.68.2 (forced by the override) | **1.73.3, single copy** | 21:45 / 21:47       |
| `@ag-ui/core` / `client` / `encoder` / `proto`                      | 0.0.54 + 0.0.57                 | **0.0.59, single copy** | 2026-08-27          |
| `@ag-ui/langgraph`                                                  | 0.0.42                          | 0.0.43                  | 2026-08-16          |
| `@ag-ui/mcp-apps-middleware`                                        | 0.0.3                           | 0.1.1                   | 2026-09-11          |
| `@langchain/core` / `@langchain/langgraph-sdk`                      | 1.2.1 / 1.9.24                  | 1.2.12 / 1.11.2         | 09-20 / 09-21       |
| `next` / `react` / `react-dom`                                      | 15.5.19 / 19.2.7                | 15.5.26 / 19.3.0        | 09-22 17:03 / 09-09 |
| `openai` (UI)                                                       | 5.23.2                          | 5.23.2                  | unchanged           |

## 2. Static checks (what Showcase CI runs for this integration)

For LangGraph Python, CI runs:

- the Docker build in `showcase_build_check.yml`: `npm ci --legacy-peer-deps`, `npm run build`, and `pip install -r requirements.txt` on Python 3.12.13;
- `static_quality.yml`'s `ruff format --check` on changed `.py` files (none changed);
- the `showcase_validate.yml` validators.

`showcase_validate.yml`'s `python-unit-tests` job only collects `tests/python/`, and LangGraph Python keeps its tests in `tests/`, so CI never runs them.

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python bytecode compile (`compileall -f src/agents tools _shared`)                                      | **Pass**, exit 0 (`lgp-python-static-20260923.log`)                                                                                                                                                                                                                            |
| Import every `langgraph.json` graph the way langgraph-api loads it (`lgp-import-graphs.py`)             | **29/29** load, and each draws its graph                                                                                                                                                                                                                                       |
| `uv pip check`                                                                                          | **Pass**, 103 packages compatible                                                                                                                                                                                                                                              |
| Informational: LangGraph Python's own pytest (`tests/`, `src/agents/test_a2ui_internal_tools.py`)       | **10/10** pass. `src/agents/test_agent_config_agent.py` fails to collect: it imports `DEFAULT_EXPERTISE`, which `agent_config_agent.py` no longer defines. This is pre-existing and unrelated to the update.                                                                   |
| `next build` (host equivalent of the Dockerfile frontend stage)                                         | **Pass**, exit 0. Next 15.5.26, 57 static pages, 33.5 s, max RSS 3.1 GB. Warnings: the known hashbrown `Critical dependency`, a `Critical dependency` in `@copilotkit/runtime`'s `channel-manager.mjs`, and workspace-root inference (`lgp-ui-next-build-20260923.log`).       |
| `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends`, `validate-fixture-tool-surface` | **Pass**. LangGraph Python passes parity, and the shared frontends are in sync (`lgp-ci-validators-20260923.log`).                                                                                                                                                             |
| `validate-pins` ratchet                                                                                 | **Red, already before this change.** The branch had 38 FAILs against the baseline's 26 (the LGTS and Built-in Agent updates). This update adds 5 more: LangGraph Python's `@copilotkit/*` pins at 1.73.3 against `showcase-canonical-pins.json`'s 1.68.2. See Remaining items. |

## 3. Boot (documented default command, strict AIMock)

- **AIMock:** the same command and flags as the LGTS runs, and 8632 fixtures loaded (`lgp-aimock-20260923.log`). No `--record`, `--proxy-only` or `--provider-*` flags were passed.

  ```sh
  AIMOCK_STRICT_TURN_INDEX=1 nice -n 10 showcase/scripts/node_modules/.bin/llmock --port 4410 --host 127.0.0.1 --strict --validate-on-load --chunk-size 8 --latency 60 --fixtures showcase/aimock/shared --fixtures showcase/aimock/d4 --fixtures showcase/aimock/d5-recorded --fixtures showcase/aimock/d6
  ```

- **Stack:** the integration's documented default command, `npm run dev`. It runs `concurrently "next dev --turbopack" "python -u -m langgraph_cli dev --config langgraph.json --host 0.0.0.0 --port 8123 --no-browser"`, with the venv's `python` first on `PATH` (`lgp-dev-stack-20260923.log`).

  ```sh
  cd showcase/integrations/langgraph-python && PORT=3100 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 LANGSMITH_TRACING=false LANGGRAPH_CLI_NO_ANALYTICS=1 OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4410/v1 AIMOCK_URL=http://127.0.0.1:4410 LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123 nice -n 10 npm run dev
  ```

  - Ignored local state was removed first: `.next` (the build output) and the 2026-09-10 `.langgraph_api` thread store (moved aside, because older runtime pickles would be restored).
  - It booted on the first attempt, with `/ok` and `/api/health` both returning 200 after 6 s.
  - The agent reported `langgraph-api=0.14.3` and `in-memory runtime=0.34.1`.
  - **All 29 `langgraph.json` graphs are registered.** `/assistants/search` lists 29 graph ids, and `/info` reports `langgraph_py_version` 1.2.12.
  - The runtime route registered 31 agent names.

- **Pre-warm:** every demo page and API route was requested sequentially (`lgp-prewarm-20260923.log`).
  - All 42 demo pages return 200. `/demos/_shared` returns 404; it is not a route.
  - The API status codes match the LGTS pattern: 200 for `/api/copilotkit`, `/api/health` and `/api/smoke`, 405 on GET for the POST-only runtimes, 401 for auth, 404 for voice and 403 for debug.

## 4. Full strict D6 matrix

The command is the same as in the LGTS runs:

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-python
```

It ran as one runner process, with `FEATURE_CONCURRENCY_D6=4` fixed in the shared driver.

|                   | Checks | Pass | Fail | Skipped |
| ----------------- | ------ | ---- | ---- | ------- |
| Raw matrix        | 40     | 40   | 0    | 0       |
| Published catalog | 40     | 40   | 0    | 0       |

- **Run:** fresh boot, HEAD `feb4591dce`, 23:11:14–23:14:34Z, 195.0 s in the driver. Logs and results: `lgp-d6-full-20260923.log`, `lgp-runtime-matrix-20260923.json` (per-feature durations) and `lgp-d6-journal-full-20260923.json`.
- **Every check passed on its first attempt.** There were 0 `feature-retry` events and no failures, so there was nothing to rerun.
  - The chat input needed a second fill+Enter 36 times. LGTS run b needed 37.
  - `auth` logged one non-fatal hydration-timing warning and passed in 57.9 s. LGTS's `auth` took 54.5 s.
- **Journal:**
  - 133 requests: 121 to `/v1/chat/completions` and 12 to `/v1/responses` (the reasoning cells). All returned 200, with **0 strict 503s**.
  - Every request carried `x-aimock-strict: true` and `x-aimock-context: langgraph-python`, which shows the header forwarding works.
  - Models: `gpt-5.4` 85 and `gpt-4o-mini` 24. The other 24 bodies were truncated by the journal, from `beautiful-chat`, `declarative-gen-ui`, `a2ui-fixed-schema` and `a2ui-recovery`.
- **Stack log:** every error line falls outside the matrix window. They come from the smoke-route checks and from the shared-state-read RED below.
- **How the 40 checks relate to the demos** is unchanged from `d6-lgp-count-reconciliation.md`:
  - there are 38 manifest feature ids;
  - `cli-start` has no D6 type;
  - `declarative-hashbrown` and `declarative-json-render` fold into `byoc`, which navigates to `declarative-hashbrown` only, so **`declarative-json-render` is routed but not directly exercised**;
  - `beautiful-chat` expands into 5 checks.
- **Policy-excluded, untested:** `gen-ui-interrupt` and `interrupt-headless`. The manifest's `not_supported_features` quarantines them pending a `@copilotkit/react-core` fix to the `useInterrupt` / `useHeadlessInterrupt` resume path. They did not run. Whether 1.73.3 fixes that path is **unknown**.

### Final count

The final count equals the first run. Since `feb4591dce`, the only tree change is `src/app/api/smoke/route.ts`. No D6 probe calls it: `/api/smoke` appears in `showcase/harness/src` only in `d2-liveness.ts`, whose own comment says the endpoint "is no longer probed".

A second full matrix would not add coverage. It would also repeat the RSS overrun described under [Resources](#resources), so none was run. Five cells did rerun green after the smoke fix, on the same stack:

- the shared-state-read GREEN;
- 4 regression cells.

## Red/green

### `shared-state-read` is discriminating (the probe fix from `71f6525af9`, the routing from `d9467aa407`)

The same stack and runner were used for both runs, each with `--demo shared-state-read`.

1. **RED (`lgp-d6-shared-state-read-red-20260923.log`, `lgp-shared-state-read-journal-red-20260923.json`).**
   - `route.ts` was temporarily reverse-applied from `d9467aa407`. The result is byte-identical to its pre-`d9467aa407` blob `38356fa1bc`, which maps `shared-state-read` to the neutral `sample_agent` (`lgp-shared-state-read-red-revert-20260923.diff`). It was not committed.
   - The probe at HEAD (including `71f6525af9`), the gated fixture and the `shared_state_read` graph were unchanged.
   - The probe's edit step (preFill hook) **completed on both attempts**, so the input showed the edited title.
   - Turn 1 then failed twice: `waitForTurnComplete: turn 1 did not complete within 55492ms (reason=dom-missing, runsFinished=0, count=0, attrPresent=true, runningNow=false, runStartCount=2)`.
   - Journal: 12 requests, all `gpt-5.4` with roles `system,user`. The system prompt was "You are a helpful, concise assistant." with no recipe, and **every request returned a 503** strict no-match.
2. **GREEN (`lgp-d6-shared-state-read-green-20260923.log`, `lgp-shared-state-read-journal-green-20260923.json`).**
   - `route.ts` was re-applied, and `git diff` confirmed it was identical to HEAD.
   - The cell passed on the first attempt in 11.8 s.
   - Both turns went out as `gpt-5.4` with `system` roles, and both system prompts contained "Lemon Saffron Orzo". They matched the two gated fixtures (`systemMessage: "Lemon Saffron Orzo"`, turn 1 with `turnIndex: 0`), both with 200.
3. **Full matrix:** `shared-state-read` also passed in the full run, in 17.6 s, and its journal shows the same two gated matches.

### `/api/smoke` lied about failed runs (fixed in `0828d39b45`, `lgp-smoke-route-20260923.log`)

- **Found during the pre-warm.** `GET /api/smoke` returned 200 `{"status":"ok"}` in 273 ms while the AIMock journal stayed empty.
  - Posting the route's own request and reading it to the end streams only `RUN_ERROR` ("Failed to create thread: HTTP 422 … Invalid thread ID: must be a UUID").
  - The cause is the route's `smoke-<ms>` thread id. The route also treats the first SSE chunk as success.
  - This is the defect LangGraph TypeScript fixed in `7e2b368bc5`.
- **Fix:** LangGraph Python's route is now that fix verbatim; only `INTEGRATION_SLUG` differs. It sends `randomUUID()` thread, run and message ids, and reads the stream to its terminal event. It returns 502 `run_error` / `run_incomplete` unless `RUN_FINISHED` arrives.
- **GREEN:** 200 `ok` in about 1.2 s. The journal shows one `gpt-5.4` request matched by the shared "Respond with exactly: OK" fixture.
- **Discriminating RED:** with the old thread id temporarily put back inside the fixed route (not committed), it returns **502 `run_error`**. With the file restored, it returns 200 `ok` again.

### Neighbouring cells, after both of the above (same stack and runner)

The smoke fix was in the tree, uncommitted, identical to the later `0828d39b45`:

- `agentic-chat`: pass, 13.1 s. This is the smoke route's agent.
- `shared-state-read-write` (`shared-state-write`): pass, 9.2 s.
- `readonly-state-agent-context`: pass, 6.5 s.
- `shared-state-streaming`: pass, 13.2 s.

All passed first time, with no retries (`lgp-d6-regression-<cell>-20260923.log`).

## 5. Setup reproduction: bring-your-own, Python tab

- **Scripts:**
  - `reproduce-lgp-byoc-setup.sh` is modelled on `reproduce-lgts-byoc-setup.sh`.
  - `extract-lgp-quickstart-python.py` makes it run the guide's own fenced blocks from `quickstart.mdx`, in document order, with the renderer's annotation comments stripped. Nothing is hand-copied.
- **Setup:** each deployment tab gets a fresh `uv init my-agent` project in its own `/private/tmp` directory.
  - The documented `OPENAI_API_KEY` is a placeholder.
  - `UV_EXCLUDE_NEWER=2026-09-22T23:00:00Z` applies the audit's publish-age floor. `LANGSMITH_TRACING=false`, `LANGGRAPH_CLI_NO_ANALYTICS=1` and `DO_NOT_TRACK=1` keep the run from reporting anywhere.
  - The start block's leading `cd ..` (leaving `frontend/`) is skipped, because the frontend steps are not reproduced.
- **Result: exit 0 (`lgp-byoc-setup-20260923.log`).**

| Tab                                                                     | Steps run                                                                                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LangSmith (`npx @langchain/langgraph-cli dev --port 8123 --no-browser`) | `uv init`; `uv add langgraph langchain-openai langchain-core python-dotenv` (44 packages: langgraph 1.2.12, langchain-openai 1.6.4, langchain-core 1.6.4); the guide's `main.py`; `touch langgraph.json` and its content; `.env` | **PASS.** `GET /ok` returned 200 after 16 s, on `localhost` and `127.0.0.1`. The server bound `127.0.0.1:8123`. `/info` reports langgraph-api 0.14.3 and langgraph 1.2.12. `sample_agent` is registered, and `GET /assistants/<id>/graph` returns 200 with nodes `__start__,mock_llm,__end__`. |
| FastAPI (`uv run main.py`)                                              | the same first two steps; `uv add ag-ui-langgraph fastapi uvicorn copilotkit`; the guide's `main.py`; `.env`                                                                                                                     | **PASS.** `GET /health` returned 200 after 6 s, with body `{"status":"ok","agent":{"name":"sample_agent"}}`. uvicorn served on `0.0.0.0:8123`.                                                                                                                                                 |

**Beyond boot: a real chat run through the guide's FastAPI route shape** (`check-lgp-byoc-fastapi-agui.sh` + `lgp-byoc-fastapi-run.mjs`, `lgp-byoc-fastapi-agui-20260923.log`):

- **Setup:** the FastAPI agent was built from the guide's blocks as above, with `OPENAI_BASE_URL` pointed at a scratch strict AIMock on :4411. That AIMock held one fixture, for the guide's first suggested prompt ("Can you tell me a joke?").
- **Run:** one `agent/run` went through `CopilotRuntime` + `HttpAgent` + `createCopilotRuntimeHandler` in single-route mode, from the Showcase's installed CopilotKit 1.73.3 / `@ag-ui/client` 0.0.59.
- **Omitted options:** `intelligence` and `identifyUser` were left out, which the guide's "Running without the Intelligence Platform?" callout documents.
- **Guide as written:** the unpinned `uv add` resolves **`ag-ui-protocol` 1.0.0**. The runtime returned 200 and streamed `RUN_STARTED` … `TEXT_MESSAGE_*` … `MESSAGES_SNAPSHOT RUN_FINISHED`, and the fixture's joke arrived intact.
- **Same agent with `ag-ui-protocol==0.1.22`:** an identical event sequence.

So the AG-UI 1.0 Python protocol package that the FastAPI tab pulls in does not break a basic text run on CopilotKit 1.73.3. Tool calls, reasoning and interrupts were not tested on that combination.

**No guide change was made:** the Python tab's steps are correct and complete as written, for both deployment tabs. Observations, not defects:

- The LangSmith tab starts a Python graph with the JavaScript CLI. That CLI warns that "Launching Python server from @langchain/langgraph-cli is experimental" and recommends the PyPI `langgraph-cli`.
  - It downloads uv 0.9.11 from GitHub on first use, then runs `uv run --with langgraph-cli[inmem] langgraph dev --host localhost …`.
  - It therefore fetches `langgraph-cli[inmem]` at start-up, unpinned. The guide's `uv add` line does not mention it, but it works.
- The FastAPI route imports `HttpAgent` from `@ag-ui/client`, which the guide never installs directly. npm hoists it from `@copilotkit/runtime`, as the check above used. pnpm's strict layout would not, but that was not reproduced.

## 6. Docs checks

All ran under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock`, after the stack was stopped.

- `npm run pretypecheck && npm run typecheck`: **pass**, both exit 0 (`lgp-qual-shell-docs-typecheck-20260923.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (1 worker, `--execArgv=--max-old-space-size=4096`): **25/25** (`lgp-qual-guard-bindings-20260923.log`).
- `current-v2-authored-guides.test.ts` + `llm-text.test.ts` (1 worker, same heap cap): **2 files, 71/71** (`lgp-qual-docs-tests-20260923.log`).
- Generation changed no tracked file.
- **Why the result is unchanged:** none of this run's changes feed a docs region. LangGraph Python's `requirements.txt`, `package.json` and the smoke route are not manifest highlights or snippet sources. The quickstart was not edited.

## Commits

| SHA          | Subject                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `feb4591dce` | chore(showcase): update LangGraph Python to current stable dependencies |
| `0828d39b45` | fix(showcase): make LangGraph Python smoke route fail on run errors     |

This record and its logs are committed after them. No shared source (`showcase/shared`, harness probes, fixtures) was changed, so no other integration is affected.

## Remaining items

1. **The `validate-pins` CI ratchet is red on this branch.** It was 38 FAILs against the baseline's 26 before this change, and is 43 after. `showcase-canonical-pins.json` still names 1.68.2 as canonical, so every integration moved to 1.73.3 (LangGraph TypeScript, Built-in Agent, now LangGraph Python) adds FAIL lines. Moving the canonical pin or re-baselining is a fleet-wide decision and was not made here.
2. **The smoke-route defect is fleet-wide.** Nineteen other integrations' `/api/smoke` routes, and the `create-integration` scaffold, still post `smoke-<ms>` thread ids and treat the first chunk as success. Only routes backed by the LangGraph API server are known to reject that id, but a first-chunk check hides any run error. No D6 or D2 probe calls these routes.
3. **Stale LangGraph Python unit test:** `src/agents/test_agent_config_agent.py` imports `DEFAULT_EXPERTISE`, which no longer exists. CI does not collect it (it runs `tests/python/` only).
4. **Strict-peer install fails** on the unused-looking `cmdk@0.2.1` (peer `react@^18`). The Dockerfile's `--legacy-peer-deps` masks it.
5. **The Docker build floats the Python transitive dependencies.** `pip install -r requirements.txt` has no lock, so a build resolves transitives at build time with no publish-age bound. The direct pins above are exact.
6. **The documented `npm run dev` runs the Python server with one job slot.** `langgraph_cli dev` without `--n-jobs-per-worker` gets `N_JOBS_PER_WORKER=1` (`langgraph_api/cli.py`), while the JavaScript CLI defaults to 10. D6's four-way concurrency still passed; this is an observation.

## Resources

- **Load:** every heavy step ran under `nice -n 10`, with one stack at a time. The 1-minute load stayed under 16. It was checked before each step (at most 10.5); the maximum sampled was 14.8, at 23:21:58Z, as the last regression cell ended.
- **RSS was sampled every 5 s** over the descendants of AIMock, the stack and the full-matrix runner, including Playwright's Chromium (`lgp-rss-run1-20260923.log`).
  - Boot plus pre-warm peaked at 8.62 GiB, with `next-server` at 7.8 GiB.
  - **The full matrix peaked at 12.06 GiB (12,644,960 KiB, 12.95 GB) at 23:12:30Z**:
    - stack 10.0 GiB (`next-server` 9.24 GiB);
    - runner plus Chromium 1.98 GiB;
    - AIMock 0.08 GiB.
  - Ten consecutive samples (23:12:10–23:12:56) were at or above 11.5 GiB. **The 12 GB budget was exceeded for about 50 s.** The figure sums RSS, so shared Chromium pages are counted more than once.
  - Afterwards, stack plus AIMock stayed at or below 6.66 GiB. The single-cell reruns (one Chromium) were not in the sample set.
  - Mitigation: no second full matrix was run (see [Final count](#final-count)). A future full LangGraph Python run should expect the same next-dev growth, which `next-server` shows under Turbopack in both LangGraph stacks.
- The docs checks ran alone, after the stack was stopped.

## Limitations

- **AIMock replay is not a live provider.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures. It does not prove model quality or real-OpenAI compatibility.
  - The claims about real OpenAI streaming (`role` first, no Chat Completions reasoning) rest on the documented contract, not on a live capture.
  - `voice` covers the bundled transcript handoff only, and `multimodal` covers the sample-button path.
- **Host-native, not Docker.**
  - The stack ran on host Node 22.16.0 and a uv venv on CPython 3.12.6. The image uses Python 3.12.13, `pip`, and `entrypoint.sh`'s `--no-reload` / `LANGGRAPH_DISABLE_FILE_PERSISTENCE=true` flags.
  - The image path and `next start` were not booted. The build was checked with host `next build` only.
- **MCP Apps needs a live external server.** The `mcp-apps` cell and Beautiful Chat's Excalidraw tools call `https://mcp.excalidraw.com/mcp` (the `MCP_SERVER_URL` default), even under strict local replay. The cell is not hermetic, and an outage there would fail it.
- **The setup reproduction proves boot and health only**, plus one text run on the FastAPI tab. The Next.js frontend, Intelligence project selection and the LangSmith-tab runtime route were not reproduced.

## Cleanup

- The stack (`npm run dev` process group) and AIMock were stopped with SIGTERM to their own process groups; both groups were empty within 2 s. The RSS sampler was stopped. Every runner exited on its own.
- The setup scripts stopped their own servers (their traps) and the scratch AIMock on :4411. Their `/private/tmp` directories were removed.
- **Ports:** 3100, 4410, 4411, 8123 and 2024 are free.
- **Leftover processes:** no `langgraph_cli`, `langgraph dev`, `llmock`, `run-local-d6`, vitest or runner-owned Chromium process remains.
- **Other processes:** none was signalled. The user's :3000 app (pid 91719) and another checkout's `next-server` 16.2.6 (pid 20318) were left alone.
- **Left in place:** ignored local state in `showcase/integrations/langgraph-python`: the regenerated `node_modules/`, `.next/` from the dev boot, and a fresh `.langgraph_api/`. The Python venv and the moved-aside 2026-09-10 thread store are in the session scratchpad.
