# Google ADK: local qualification on published CopilotKit 1.73.3 and current stable Python (2026-09-23)

**Verdict: qualified, 40 of 40.** The full strict D6 matrix passed 40 of 40 checks on its first run, every check on its first attempt, with no feature retries. The published-catalog count is also 40 of 40. The first run is also the final result: nothing failed, so nothing was rerun, and the only product changes after the matrix (the quickstart's Python prerequisite) are not read by any D6 probe.

The matrix ran as **three batches, each on its own fresh boot**, instead of LGP's single runner process. One boot's `next-server` alone reached 7.8 GB after a full pre-warm, so a single-boot run with four Chromium contexts would have passed the 11 GB audit cap. The runner, driver, probes, AIMock mode and `FEATURE_CONCURRENCY_D6=4` are unchanged. See [Resources](#resources).

|                                | Result                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw matrix / published catalog | **40/40** and **40/40**. First run = final. 129.9 s in the driver over three batches (22 + 10 + 8), 0 feature retries.                                                                      |
| AIMock journal (full run)      | 134 requests, all 200, **0 strict 503s**. All carry `x-aimock-strict: true` and `x-aimock-context: google-adk`. All are `gemini-3.1-flash-lite`.                                            |
| `shared-state-read` red/green  | **RED** on the pre-`d9467aa407` routing: 4 × strict 503, turn 1 times out on both attempts. **GREEN** at HEAD in 10.5 s, both gated fixtures matched.                                       |
| HITL framing                   | All three HITL cells are tool-based (frontend tool call, user decision returned as the tool result). No interrupt path is used; ADK has none.                                               |
| Defects found and fixed        | `/api/smoke` answered 200 "ok" on a run whose model call failed (`b2323ec714`). The quickstart said Python 3.9+, where its install step cannot resolve (`5a6670620e`).                      |
| Static checks                  | Python compile and import pass (31 modules, 41 agents mounted), as do `uv pip check`, the CI-collected pytest (80/80), `next build` and the CI validators. `validate-pins` was already red. |
| Bring-your-own setup           | **PASS** as written after the prerequisite fix: the guide's agent boots and a run through the guide's own route file finishes.                                                              |
| Docs checks (under the lock)   | pretypecheck and typecheck pass, the guard passes 25/25, and `current-v2-authored-guides` + `llm-text` pass 71/71.                                                                          |
| Peak audit RSS                 | **10.38 GB** (9.67 GiB), in matrix batch A. Under the 11 GB cap; nothing was aborted.                                                                                                       |

## Provenance

- **Worktree:** `tyler/docs-feature-audit`.
  - The dependency update is `470d4f597f`; the static checks and boot 1 ran on it. The smoke fix `b2323ec714` and the runner's `--demos` option `4671e32887` came next; the matrix, red/green and regression cells ran at `4671e32887` with the tree clean outside `tasks/`. The quickstart fix is `5a6670620e`; the docs checks ran there.
  - Another agent committed `1508fbb266` (`hill-climb.md` only) on this branch during the run. It touches no integration source.
- **No other stack ran.** Only this ADK stack and its AIMock were up. The user's :3000 app and another checkout's :3003 server were not touched.
- **CopilotKit is unpatched and registry-published** (`adk-copilotkit-provenance-20260923.log`):
  - JS: every `@copilotkit/*` entry is 1.73.3 (with the matching `channels-*` 0.11.0 and `license-verifier` 0.5.0), and every `@ag-ui/*` entry is the version 1.73.3 depends on. Each resolves from `registry.npmjs.org`, and its lock integrity equals the registry's `dist.integrity`. `npm ci` verified the tarballs. The lock has no `link:`, `file:` or git sources.
  - Python: `ag-ui-adk` 0.7.0, `ag-ui-protocol` 0.1.22, `google-adk` 2.9.2, `google-genai` 2.25.0 and `a2ui-agent-sdk` 0.2.4 were installed by uv from `https://pypi.org/simple`, with no `direct_url`.
- **Toolchain:** the stack, runner, build and setup reproduction used Node v22.16.0 / npm 10.9.2; the UI lock was generated with Node v24.11.0 / npm 11.6.1, as LGP and LGTS did. Python is a uv 0.11.7 venv on host CPython 3.12.6 (the Dockerfile uses 3.12.13). `@copilotkit/aimock` 1.37.4.

## 1. Dependencies

### Python (`requirements.txt`)

Resolved with `uv pip install -r requirements.txt --exclude-newer 2026-09-22T23:00:00Z --index-url https://pypi.org/simple` at 2026-09-23T23:42:42Z, 24.7 hours after the bound (`adk-python-install-20260923.log`).

- Each direct package was surveyed on PyPI at the bound (`adk-pypi-survey-20260923.json`): no direct package has a newer release after it, so the bound held nothing back.
- All 73 resolved packages were dated individually (`adk-python-resolution-20260923.json`): **0 violations**. The youngest is `google-genai` 2.25.0, at 30.3 hours.
- `uv pip check`: all 73 packages are compatible.

| Package                     | Before                             | After                     | Published (UTC)  | Age at resolution | Note                                                                            |
| --------------------------- | ---------------------------------- | ------------------------- | ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `google-adk`                | unpinned (2.8.0 in the 09-10 venv) | **==2.9.2**               | 2026-09-18 18:10 | 125.5 h           | the survey's 2.9.2                                                              |
| `google-genai`              | `>=0.8.0`                          | **==2.25.0**              | 2026-09-22 17:22 | 30.3 h            | google-adk 2.9.2 needs `>=2.19,<3`                                              |
| `ag-ui-adk`                 | ==0.7.0                            | ==0.7.0                   | 2026-06-23 05:58 | 2225.7 h          | latest; needs `google-adk>=1.28.1,<3`                                           |
| `a2ui-agent-sdk`            | transitive                         | **==0.2.4**               | 2026-06-03 23:09 | 2688.6 h          | the only release in ag-ui-adk's `>=0.2.4,<0.3.0`; 0.3.0–0.6.0 exist             |
| `ag-ui-protocol`            | ==0.1.18                           | **==0.1.22**              | 2026-08-31 18:20 | 557.4 h           | 1.0.0 (09-17) exists; kept off it, CopilotKit 1.73.3 does not support AG-UI 1.0 |
| `fastapi`                   | `>=0.115.0`                        | **`>=0.141.1`** (0.141.1) | 2026-07-29 17:18 | 1350.4 h          | google-adk 2.9.2 needs `>=0.133`; floor = what resolves                         |
| `uvicorn[standard]`         | `>=0.34.0`                         | **`>=0.53.0`** (0.53.0)   | 2026-09-14 07:44 | 232.0 h           | ag-ui-adk 0.7.0 needs `>=0.35`; floor = what resolves                           |
| `python-dotenv`, `pydantic` | unpinned                           | unpinned (1.2.3, 2.13.5)  | 08-16 / 08-28    | —                 | unchanged                                                                       |

Key transitive packages: `ag-ui-a2ui-toolkit` 0.0.4, `a2a-sdk` 1.1.5, `starlette` 1.6.0, `sse-starlette` 3.4.11.

### JS (`package.json`, `package-lock.json`)

- **`package.json`:** every `@copilotkit/*` dependency (a2ui-renderer, react-core, runtime, shared, voice) goes to exactly `1.73.3`, and `@ag-ui/client` from 0.0.57 to exactly **0.0.59**, the version CopilotKit 1.73.3 pins. There was no core override to drop. No other range changed.
- **Lock generated fresh** (`adk-ui-lock-update-20260923.log`): `rm -rf node_modules package-lock.json && npm install --package-lock-only --legacy-peer-deps --before=2026-09-22T23:00:00Z`.
  - A strict-peer attempt succeeds here, but it installs peers through open ranges: 27 peer-flagged entries, and a root `@ag-ui/core` **1.0.0** through `@copilotkit/shared`'s open `@ag-ui/core >=0.0.48` peer. The Dockerfile installs with `npm ci --legacy-peer-deps` and the committed lock was a legacy-peer lock (0 peer entries), so the lock is generated in that mode, as LGP did.
  - Result: 894 entries, 0 peer-flagged, all from `registry.npmjs.org`. `@ag-ui/core` and `@ag-ui/client` resolve to a **single 0.0.59 copy**; the old 0.0.54 copies under `@ag-ui/mcp-middleware` are gone.
- **Age audit (`adk-ui-lock-age-audit-20260923.json`):** all 261 added or changed name@version pairs were published at or before the bound, **0 violations**. The youngest is the `@copilotkit/*` 1.73.3 set, at 26 hours.
- **Clean install as the Dockerfile does it:** `npm ci --legacy-peer-deps` (npm 10.9.2) added 837 packages, exit 0 (`adk-ui-npm-ci-20260923.log`).

| Package                                                       | Before                 | After                   |
| ------------------------------------------------------------- | ---------------------- | ----------------------- |
| `@copilotkit/react-core`, `runtime`, `core`, `shared`, etc.   | 1.68.2                 | **1.73.3**              |
| `@ag-ui/core` / `client` / `encoder`                          | 0.0.54 + 0.0.57        | **0.0.59**, single copy |
| `@ag-ui/langgraph` / `mcp-apps-middleware` / `mcp-middleware` | 0.0.42 / 0.0.3 / 0.0.1 | 0.0.43 / 0.1.1 / 0.0.2  |
| `next` / `react` / `react-dom`                                | 15.5.19 / 19.2.7       | 15.5.26 / 19.3.0        |
| `@modelcontextprotocol/sdk` / `@playwright/test`              | 1.29.0 / 1.61.0        | 1.30.0 / 1.63.0         |
| `openai` (UI) / `typescript`                                  | 5.23.2 / 5.9.3         | unchanged               |

## 2. Static checks (what Showcase CI runs for this integration)

For Google ADK, CI runs the Docker build in `showcase_build_check.yml` (`npm ci --legacy-peer-deps`, `npm run build`, `pip install -r requirements.txt` on 3.12.13), the `showcase_validate.yml` validators, and `showcase_validate.yml`'s `python-unit-tests` job, which **does** collect ADK's `tests/python/`, on Python 3.10 and 3.12.

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileall -f src tools/ _shared/` (what the Dockerfile copies)                                        | **Pass**, exit 0 (`adk-python-static-20260923.log`)                                                                                                                                                                                                                             |
| Import every agent module, then `agent_server`, as uvicorn does (`adk-import-agents.py`)                | **31/31** modules import; **41/41** `AGENT_REGISTRY` entries are `LlmAgent`s mounted as `POST /<name>`                                                                                                                                                                          |
| `uv pip check`                                                                                          | **Pass**, 73 packages                                                                                                                                                                                                                                                           |
| `pytest tests/python/` (CI's command and deps, bounded)                                                 | **80/80** pass (`adk-python-pytest-20260923.log`). The CI 3.10 leg was not reproduced: no local 3.10 interpreter. The resolver accepts 3.10 (§6).                                                                                                                               |
| `next build`                                                                                            | **Pass**, exit 0. Next 15.5.26, 57 static pages, 30.3 s, max RSS 3.0 GB. Warnings: the known hashbrown and runtime `Critical dependency` lines and workspace-root inference (`adk-ui-next-build-20260923.log`).                                                                 |
| `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends`, `validate-fixture-tool-surface` | **Pass** (`adk-ci-validators-20260923.log`). ADK: 38 demos, 37 specs, 35 QA files, 8 warnings, all pre-existing.                                                                                                                                                                |
| `validate-pins` ratchet                                                                                 | **Red, already before this change.** The same validator on the pre-update tree gives FAIL 43; after, 47: **+5** (`@copilotkit/*` 1.73.3 against the canonical 1.68.2) and **−1** (`google-genai` is now an exact pin). WARN 3 → 2 (`google-adk` is now pinned). Not fixed here. |
| `ruff format --check` on changed `.py` files                                                            | The only new `.py` is `tasks/…/adk-import-agents.py`; formatted.                                                                                                                                                                                                                |

## 3. Boot (documented default command, strict AIMock)

- **AIMock:** the LGP command and flags, 8632 fixtures loaded, no `--record`, `--proxy-only` or `--provider-*` flags (`adk-aimock-20260923.log`):

  ```sh
  AIMOCK_STRICT_TURN_INDEX=1 nice -n 10 showcase/scripts/node_modules/.bin/llmock --port 4410 --host 127.0.0.1 --strict --validate-on-load --chunk-size 8 --latency 60 --fixtures showcase/aimock/shared --fixtures showcase/aimock/d4 --fixtures showcase/aimock/d5-recorded --fixtures showcase/aimock/d6
  ```

- **Stack:** the documented default command, `npm run dev`, which runs `concurrently "next dev --turbopack" "cd src && PYTHONPATH=.. python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 --reload"`, with the venv's `python` first on `PATH` (`adk-dev-stack-20260923.log`):

  ```sh
  cd showcase/integrations/google-adk && PORT=3103 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 GOOGLE_API_KEY=fake-gemini-key GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:4410 OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4410/v1 AIMOCK_URL=http://127.0.0.1:4410 AGENT_URL=http://localhost:8000 nice -n 10 npm run dev
  ```

  - `.next` (the build output) was removed first. Agent `/health` and UI `/api/health` returned 200 after 3 s.
  - **All agents mount.** FastAPI lists 42 `POST` routes: the 41 registry agents plus `/agents/state`. The runtime's `info` reports version 1.73.3 and 40 agents; the 41st backend agent, `a2ui_recovery`, is served by its own route (`/api/copilotkit-a2ui-recovery`).

- **Pre-warm** (`adk-prewarm-20260923.log`): all 40 demo pages return 200 (`/demos/_shared` 404 is not a route). API codes match LGP's pattern: 200 for `/api/copilotkit` and `/api/health`, 405 on GET for the 10 POST-only runtimes, 401 for auth, 404 for voice, 403 for debug. `/api/smoke` was checked separately (§5).

## 4. Full strict D6 matrix

The runner command is LGP's, with the new `--demos` subset (`4671e32887`) naming each batch:

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts google-adk --demos <batch>
```

Each batch ran as one runner process at `FEATURE_CONCURRENCY_D6=4`, on its own fresh boot (`.next` removed, then the batch's demo pages and every API route pre-warmed). AIMock stayed up across batches; its journal was reset before each.

| Batch | Manifest features                                 | Checks | Pass | Driver | Logs                                                                |
| ----- | ------------------------------------------------- | ------ | ---- | ------ | ------------------------------------------------------------------- |
| A     | the first 19 (`beautiful-chat` … `a2ui-recovery`) | 22     | 22   | 48.2 s | `adk-d6-full-A-20260923.log`, `adk-dev-stack-matrix-A-20260923.log` |
| B1    | `gen-ui-agent` … `multimodal` (10)                | 10     | 10   | 27.3 s | `…-B1-…`                                                            |
| B2    | `auth` … `gen-ui-interrupt` (9)                   | 8      | 8    | 54.4 s | `…-B2-…`                                                            |

|                   | Checks | Pass | Fail | Skipped |
| ----------------- | ------ | ---- | ---- | ------- |
| Raw matrix        | 40     | 40   | 0    | 0       |
| Published catalog | 40     | 40   | 0    | 0       |

- **Run:** 23:59:52–00:03:44Z at HEAD `4671e32887`. Per-feature durations are in `adk-runtime-matrix-20260923.json`.
- **Every check passed on its first attempt.** 0 `feature-retry` events, so there was nothing to rerun. The chat input needed a second fill+Enter 35 times (LGP: 36). `auth` logged one non-fatal hydration-timing warning and passed in 54.0 s (LGP: 57.9 s).
- **Journal** (`adk-d6-journal-full-{A,B1,B2}-20260923.json`): 134 requests (63 + 53 + 18), 131 `streamGenerateContent` and 3 `generateContent`, all `gemini-3.1-flash-lite`, all 200, **0 strict 503s**. Every request carries `x-aimock-strict: true` and `x-aimock-context: google-adk`, so the Next route → FastAPI → google-genai header forwarding works on google-adk 2.9.2. (At import, `install_httpx_hook` still warns that a `Gemini` object has no `event_hooks`; the global httpx hook does the forwarding.)
- **Mapping of the 40 checks** is the same shape as LGP's: 38 manifest features, `cli-start` has no D6 type, `declarative-hashbrown` and `declarative-json-render` fold into `byoc` (which navigates to `declarative-hashbrown` only, so **`declarative-json-render` is routed but not directly exercised**), and `beautiful-chat` expands into 5 checks. All 40 map to shipped demos, so the published count equals the raw count.
- **Not in the D6 input, untested:** the routed `tool-rendering-reasoning-chain` demo is not in the manifest's `features` list, so the runner never passes it. `interrupt-headless` is in `not_supported_features` (no demo). The unlisted `/demos/hitl` and `/demos/threadid-frontend-tool-roundtrip` pages have no manifest demo record.
- **Stack logs:** no HTTP 500. The Python side logs 34 non-fatal OpenTelemetry `Failed to detach context` pairs (`ValueError: … was created in a different Context`) when a run's generator closes, and 17 `Root node <agent> was cancelled.` lines, all on frontend-tool and cancelled turns. No check failed on them.

### HITL cells follow the documented tool-based framing

The root HITL guide says ADK has no native interrupt primitive and to use tool-based approval (`b50e674547`, REPAIR-003). The agents and the journal agree:

| Check (demo)                        | Agent                                          | Frontend hook                                   | Journal                                                                                                                     |
| ----------------------------------- | ---------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `hitl-approve-deny` (`hitl-in-app`) | `HitlInAppAgent`, `AGUIToolset()` only         | async `useFrontendTool` `request_user_approval` | turn 1 returns a `request_user_approval` call; turn 2 carries the tool result `{"approved":true}` and gets the confirmation |
| `hitl-text-input` (`hitl-in-chat`)  | `HitlInChatBookCallAgent`                      | `useHumanInTheLoop` `book_call`                 | `book_call` call, then the picked slot as the tool result, then the booking text                                            |
| `gen-ui-interrupt`                  | `InterruptAgent` (Strategy B, no backend tool) | `useHumanInTheLoop` `schedule_meeting`          | two meetings, each a `schedule_meeting` call followed by the chosen slot as its tool result                                 |

No backend tool implements these, no page in a D6 cell uses `useInterrupt`, and no interrupt event is involved. (The unlisted `/demos/hitl` page still imports `useInterrupt`; it is not a manifest demo.)

## Red/green

### `shared-state-read` is discriminating (the routing and before-model callback from `d9467aa407`)

Same fresh boot (`adk-dev-stack-redgreen-20260923.log`) and runner for both runs, each with `--demo shared-state-read`.

1. **RED (`adk-d6-shared-state-read-red-20260923.log`, `adk-shared-state-read-journal-red-20260923.json`).**
   - The `registry.py` half of `d9467aa407` was temporarily reverse-applied (`adk-shared-state-read-red-revert-20260923.diff`): `"shared-state-read"` maps back to `_simple_chat`. The file was then byte-identical to the pre-`d9467aa407` blob `0bf08b576d`. uvicorn `--reload` picked it up. It was not committed.
   - The probe, the gated fixture and `shared_state_read_agent` were unchanged at HEAD.
   - The probe's edit step (preFill) **completed on both attempts**. Turn 1 then failed twice: `waitForTurnComplete: turn 1 did not complete within 57434ms (reason=dom-missing, runsFinished=0, count=0, attrPresent=true, runningNow=false, runStartCount=2)`. 123.4 s.
   - Journal: 4 requests, the simple chat agent's system prompt ("You are a helpful, concise assistant…") with no recipe, **every one a 503** strict no-match.
2. **GREEN (`adk-d6-shared-state-read-green-20260923.log`, `adk-shared-state-read-journal-green-20260923.json`).**
   - `registry.py` restored; `git diff` against HEAD empty; uvicorn reloaded.
   - Passed on the first attempt in 10.5 s. Both requests carried "Lemon Saffron Orzo" in the system instruction (appended by `_inject_recipe`) and matched the two gated fixtures (`systemMessage: "Lemon Saffron Orzo"`, turn 1 with `turnIndex: 0`), both 200.
3. **Full matrix:** `shared-state-read` also passed in batch B1 (10.6 s) with the same two gated matches.

### `/api/smoke` reported success for failed runs (fixed in `b2323ec714`, `adk-smoke-route-20260923.log`)

- **Found at boot.** `GET /api/smoke` returned 200 `{"status":"ok"}` in 1.9 s while the AIMock journal was still empty. The route returns at the first SSE chunk, and ADK always streams `RUN_STARTED` before it calls the model.
  - ADK accepts the old `smoke-<ms>` thread id (in-memory sessions don't validate it): the route's own request, read to the end, finishes with "OK". So LangGraph's thread-id failure does not apply here; the first-chunk check does.
  - **Discriminating before-state:** with one non-retryable 400 queued through AIMock's `/__aimock/error` control endpoint, the old route still answered **200 "ok"**. The journal shows the 400, and the same run read to the end is `RUN_STARTED` → `RUN_ERROR 400 invalid_request_error`.
- **Fix:** the LangGraph fix from `0828d39b45` / `7e2b368bc5`, verbatim except the slug and two comments: `randomUUID()` ids, and the stream read to its terminal event, answering 502 `run_error` / `run_incomplete` unless `RUN_FINISHED` arrives.
- **After:** 200 `ok` in about 0.3 s, with one request matched by the shared "Respond with exactly: OK" fixture. With the same 400 queued, **502 `run_error`** ("Run failed: 400 invalid_request_error…"). Unqueued again: 200. Re-checked at the committed route on the red/green boot: same results.

### Neighbouring cells after both (same boot and runner, fix committed)

`agentic-chat` (the smoke route's agent) 10.7 s, `shared-state-read-write` 7.1 s, `shared-state-streaming` 10.2 s and `readonly-state-agent-context` 5.6 s: all pass first time, no retries (`adk-d6-regression-<cell>-20260923.log`).

### Quickstart prerequisite (fixed in `5a6670620e`)

See §6: RED `adk-byoc-prereq-red-20260923.log`, GREEN `adk-byoc-setup-20260923.log`.

## 5. Smoke route

See the `/api/smoke` entry under [Red/green](#redgreen). D6 does not call `/api/smoke` (it appears in `showcase/harness/src` only in `d2-liveness.ts`, which says it is no longer probed), so the fix changes no D6 count.

## 6. Setup reproduction: bring-your-own (`/google-adk/quickstart`, "Use an existing agent")

- **Guide:** `showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx`, the page `google-adk` resolves to through `getDocsFolder()` (`"google-adk": "adk"` in `registry.ts`).
- **Scripts:** `reproduce-adk-byoc-setup.sh`, modelled on `reproduce-lgp-byoc-setup.sh`. `extract-adk-quickstart.py` makes it run the guide's own fenced blocks from the `bring-your-own` option, in document order, annotations stripped; nothing is hand-copied. `adk-byoc-runtime-run.mts` imports the guide's route file and drives it.
- **What runs, per variant, in fresh `/private/tmp` directories:**
  - Agent: `uv init my-agent`, the guide's `uv add ag-ui-adk google-adk uvicorn fastapi`, its `export GOOGLE_API_KEY=your_google_api_key` line (the guide's own placeholder), its `main.py`, and its start block `uv run main.py`. Readiness is FastAPI's `GET /openapi.json` (the guide's app has no health route).
  - Frontend: `npm init -y` stands in for `npx create-next-app@latest`; then the guide's `npm install @copilotkit/react-core @copilotkit/runtime @ag-ui/client`; then its `app/api/copilotkit/[[...slug]]/route.ts`, with the guide's "Running without the Intelligence Platform?" callout applied (the `intelligence` and `identifyUser` options dropped; the diff is printed).
  - Run: `GET /api/copilotkit/info`, then `POST /api/copilotkit/agent/my_agent/run` with the guide's first prompt, "Can you tell me a joke?", exactly the calls the guide's provider (`useSingleEndpoint={false}`, `agent="my_agent"`) makes, through the route's exported handlers.
  - The model call goes to a scratch strict AIMock on :4411 with one fixture, via google-genai's own `GOOGLE_GEMINI_BASE_URL`. `UV_EXCLUDE_NEWER` / npm `--before` = 2026-09-22T23:00Z.
  - Not reproduced: the Next.js scaffold and React files, `npx copilotkit@latest project select` and the Intelligence key.

**Defect found: the Python prerequisite was wrong.** The guide said "Python 3.9+", but `google-adk` 2.9.2 and `ag-ui-adk` 0.7.0 both require Python ≥ 3.10.

- **RED (`adk-byoc-prereq-red-20260923.log`).** The script's prerequisite check reads the guide's "Python X.Y+" line and resolves the guide's `uv add` line in a `uv init` project with `requires-python = ">=X.Y"`. Against the pre-fix guide: `No solution found when resolving dependencies for split (markers: python_full_version == '3.9.*')`. A real Python 3.9.6 interpreter (`uv init --python /usr/bin/python3`) fails the same way.
- **Fix (`5a6670620e`):** "Python 3.10+ (`google-adk` and `ag-ui-adk` require it)".
- **GREEN (`adk-byoc-setup-20260923.log`, exit 0):** the check resolves at `>=3.10` (ag-ui-adk 0.7.0, google-adk 2.9.2, google-genai 2.25.0). No 3.10 interpreter was available, so 3.10 is proven at resolver level only; the end-to-end runs use 3.12.6.

| Variant                                                                           | Resolved                                                                                                                                                                              | Result                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **as written**                                                                    | ag-ui-adk 0.7.0, google-adk 2.9.2, google-genai 2.25.0, **ag-ui-protocol 1.0.0**; npm: runtime 1.73.3, **`@ag-ui/client` ^0.0.59** (npm dedupes it to the runtime's pin; single copy) | **PASS.** `openapi.json` 200 after 4 s on `localhost:8000` (IPv4 and IPv6); routes `POST /`, `POST /agents/state`, `GET /capabilities`. `info` 200 with `my_agent`; the run streams `RUN_STARTED … TEXT_MESSAGE_* … STATE_SNAPSHOT RUN_FINISHED` with the fixture's joke; one `gemini-2.5-flash` request matched. |
| `+ ag-ui-protocol==0.1.22` (the Showcase pin)                                     | as above, protocol 0.1.22                                                                                                                                                             | **PASS**, identical event sequence                                                                                                                                                                                                                                                                                |
| `+ @ag-ui/client@1.0.0` (a root 1.0.0 copy, as a `latest`-tag install would give) | the route's `HttpAgent` from 1.0.0; the runtime keeps its nested 0.0.59                                                                                                               | **PASS**, identical event sequence                                                                                                                                                                                                                                                                                |

So the AG-UI 1.0 packages the unpinned lines can pull in do not break a basic text run on CopilotKit 1.73.3. Tool calls, state and HITL on those combinations were not tested. No other guide step was wrong.

## 7. Docs checks

All ran under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock` after the stack was stopped, at `5a6670620e`, on Node 22.16.0:

- `npm run pretypecheck && npm run typecheck`: **pass**, both exit 0 (`adk-qual-shell-docs-typecheck-20260923.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (`--pool=forks --maxWorkers=1 --execArgv=--max-old-space-size=4096`): **25/25** (`adk-qual-guard-bindings-20260923.log`).
- `current-v2-authored-guides.test.ts` + `llm-text.test.ts` (same flags): **2 files, 71/71** (`adk-qual-docs-tests-20260923.log`).
- Generation changed no tracked file. None of this run's integration changes feed a docs region (`requirements.txt`, `package.json` and the smoke route are not highlights or snippet sources); the quickstart edit is prose.

## Commits

| SHA          | Subject                                                           |
| ------------ | ----------------------------------------------------------------- |
| `470d4f597f` | chore(showcase): update Google ADK to current stable dependencies |
| `b2323ec714` | fix(showcase): make Google ADK smoke route fail on run errors     |
| `4671e32887` | test(audit): let the local D6 runner take a demo subset           |
| `5a6670620e` | docs(adk): require Python 3.10 in the quickstart prerequisites    |

This record, its scripts and logs are committed after them. No shared source (`showcase/shared`, harness probes, fixtures, the D6 driver) was changed, so no other integration is affected.

## Remaining items

1. **`validate-pins` is red on this branch:** 43 → 47 FAILs against the baseline's 26. `showcase-canonical-pins.json` still says 1.68.2; moving it is a fleet-wide decision.
2. **The smoke-route defect is fleet-wide:** 18 other `/api/smoke` routes and the `create-integration` scaffold still treat the first chunk as success (3 of 21 are fixed: LGTS, LGP, ADK).
3. **`tool-rendering-reasoning-chain` is routed but not in the manifest's `features`,** so D6 never runs it. The unlisted `/demos/hitl` page imports `useInterrupt`, which ADK cannot drive.
4. **Python log noise:** OpenTelemetry `Failed to detach context` tracebacks on every closed ADK run generator (34 in the matrix), and the import-time `install_httpx_hook` warning for `Gemini`. Neither affected a check.
5. **The Docker build floats Python transitive dependencies** (`pip install -r requirements.txt`, no lock). The direct pins are exact except `fastapi`, `uvicorn`, `python-dotenv` and `pydantic`.
6. **Unpinned guide installs:** `uv add` resolves `ag-ui-protocol` 1.0.0, and the pnpm/yarn/bun tabs of `npm install … @ag-ui/client` were not run (npm dedupes to 0.0.59). Text runs work on both 1.0 shapes; richer features on them are untested.

## Resources

- **Load:** every heavy step ran under `nice -n 10`, one stack at a time. The 1-minute load was checked before each step (at most 7.7) and never exceeded 16; the maximum sampled was 8.5.
- **RSS was sampled** over the descendants of AIMock, each stack boot and each runner (Playwright's Chromium included), every 5 s during boot 1 and every 2 s from the matrix on (`adk-rss-20260923.log`). The sampler would have sent SIGTERM to the runner at ≥ 10.5 GB; it never did.

  | Phase                               | Peak (sum of RSS)                           | Largest process                                  |
  | ----------------------------------- | ------------------------------------------- | ------------------------------------------------ |
  | Boot 1: full pre-warm, smoke checks | 8.77 GB (8.17 GiB)                          | `next-server` 7.97 GB                            |
  | Matrix A (22 checks)                | **10.38 GB (9.67 GiB)**, 9 samples ≥ 9.5 GB | `next-server` 7.62 GB; runner + Chromium 2.01 GB |
  | Matrix B1 (10 checks)               | 8.36 GB                                     | `next-server` 5.95 GB                            |
  | Matrix B2 (8 checks)                | 7.15 GB                                     | `next-server` 4.91 GB                            |
  | Red/green + 4 regression cells      | 5.48 GB                                     | `next-server`                                    |
  - **Why the matrix was split.** After boot 1's full pre-warm, `next-server` held 7.8 GB (`vmmap` put 6.6 GB of it in `IOAccelerator`-tagged regions and about 0.7 GB in tag-255 regions). It grows with the routes it has compiled: in batch A it went from 0 to 5.3 GB over the pre-warm of 18 pages and the API routes, then gained 2.1 GB during the run as the browser pulled client bundles. Adding about 2 GB of runner and Chromium at concurrency 4 would have put one boot of all 40 checks near 12 GB. The plan was two batches; batch A's 10.38 GB peak came close enough to the abort line that the second half was split again (B1, B2).
  - The figure sums RSS, so shared pages are counted more than once.

- The setup reproduction and docs checks ran alone, after the stack was stopped.

## Limitations

- **AIMock replay is not live Gemini.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures, not model quality or real Gemini compatibility (including whether `gemini-3.1-flash-lite` streams the same shapes). `voice` covers the bundled transcript handoff only, and `multimodal` the sample-button path.
- **Host-native, not Docker.** Host Node 22.16.0 and a uv venv on CPython 3.12.6; the image uses Python 3.12.13, `pip`, `entrypoint.sh` (no `--reload`) and `next start`, none of which were booted. The build was checked with host `next build` only. CI's Python 3.10 pytest leg was not reproduced.
- **MCP Apps needs a live external server.** `mcp-apps` and Beautiful Chat's Excalidraw tools discover `create_view` from `https://mcp.excalidraw.com/mcp` even under strict replay. They passed, but the cells are not hermetic.
- **The matrix is three runner processes on three boots,** not LGP's one; per-batch behaviour is otherwise identical.
- **The setup reproduction proves the agent and the runtime route**, one text run, on Python 3.12. The Next.js app, the React files, the Intelligence path and the starter (`npx copilotkit@latest create`) path were not reproduced; Python 3.10 is proven at resolver level only.

## Cleanup

- Each stack boot (`npm run dev` process group) and AIMock were stopped with SIGTERM to their own process groups; every group was empty within 2 s. The RSS sampler was stopped. Every runner exited on its own.
- The setup scripts stopped their own agents and the scratch AIMock on :4411 (their traps) and removed their `/private/tmp` directories; the ad-hoc 3.9 check directory was removed.
- **Ports:** 3103, 8000, 4410 and 4411 are free.
- **Leftover processes:** no `uvicorn`, `llmock`, `run-local-d6`, vitest or runner-owned Chromium process remains.
- **Other processes:** none was signalled. The user's :3000 app and another checkout's :3003 server were left alone.
- **Left in place:** ignored local state in `showcase/integrations/google-adk`: the regenerated `node_modules/` and `.next/` from the last boot. The Python venv is in the session scratchpad.
