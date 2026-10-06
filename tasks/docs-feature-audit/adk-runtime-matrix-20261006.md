# Google ADK: requalification on published CopilotKit 1.77.0 and AG-UI 1.0 (2026-10-06)

**Verdict: qualified, 40 of 40.** The first full strict D6 run passed **40 of 40** (raw and published), every check on its first attempt, with all 134 AIMock requests answered 200 and every one carrying `x-aimock-strict`, `x-aimock-context: google-adk` and `x-test-id`. Nothing failed, so nothing was rerun and no product code changed after the dependency update.

The A2UI recheck asked for found that ADK does **not** have the LangGraph Python defect: its declarative agent wires no `generate_a2ui`, the outer call advertises only the adapter-injected `generate_a2ui`, and the shipped fixtures already run the three-call flow. A scratch fixture set that answers the outer call with `generate_a2ui` only when it carries the agent's instruction passes; the same set fails when the LGP-style stub is put back (negative control). The control also exposed an upstream `ag-ui-adk` 0.7.1 bug in its "user prevails" check (see Upstream findings).

|                                     | Result                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First run = final (raw / published) | **40/40 / 40/40** at `e737fc702f`. 0 feature retries; 149.1 s in the driver over five batches; 134 requests, all 200, 0 strict 503s, 134/134 with all three forwarded headers.                                           |
| `shared-state-read` (mandatory)     | Green in the matrix (13.8 s) and gated on **"Lemon Saffron Orzo"** on both turns. **RED** on the pre-`d9467aa407` routing: 4 × strict 503, turn 1 times out on both attempts. **GREEN** 12.8 s, plus 3 neighbours green. |
| HITL framing                        | All three HITL cells are tool-based: a frontend tool call, then the user's decision as the tool result. No `useInterrupt`, no interrupt event.                                                                           |
| A2UI / `generate_a2ui`              | Shipped fixtures: 3-call flow (outer `generate_a2ui` → inner `render_a2ui` → `toolCallId` follow-up). Scratch instruction-gated fixtures: **GREEN** twice. LGP-style stub: **RED** (negative control), then restored.    |
| `mcp-apps`                          | Passed (6.0 s); `create_view` discovered from the live Excalidraw MCP server.                                                                                                                                            |
| Static checks                       | `compileall`, 31/31 modules and 41/41 agents mounted, `uv pip check` (73), pytest 80/80, `next build` and the four validators pass. `validate-pins` red at 47 → 47 (the hash changes).                                   |
| Bring-your-own setup                | **PASS** as written: the guide's agent boots and a run through the guide's own `route.ts` reaches `RUN_FINISHED`. The extractor finds all 20 of the option's fenced blocks. No guide change was needed.                  |
| Docs checks (under the lock)        | pretypecheck and typecheck pass; guard 25/25; `current-v2-authored-guides` + `llm-text` 72/72.                                                                                                                           |
| Peak audit RSS                      | **8.34 GB** (8,143,280 KiB), in batch A2. Under the 11 GB cap; the 10.5 GB abort line never fired.                                                                                                                       |

## Provenance

- **Worktree:** `tyler/docs-feature-audit`. `git pull --ff-only` was a no-op at `3e043e217a`, and the tree was clean. The dependency update is `e737fc702f`. The Python static checks, pytest and `next build` ran on the same tree just before it was committed; the validators, the boot, the matrix, the A2UI checks, the red/green, the setup reproduction and the docs checks ran at it, with `showcase/` clean apart from the temporary, uncommitted red/negative-control edits named below.
- **CopilotKit is unpatched and registry-published** (`adk-copilotkit-provenance-20261006.log`).
  - **JS:** all 26 `@copilotkit/*` and `@ag-ui/*` lock entries resolve from `registry.npmjs.org`, and each one's lock integrity equals the registry's `dist.integrity`. The lock has no `link:`, `file:` or git sources.
  - **Python:** `ag-ui-adk` 0.7.1, `ag-ui-protocol` 1.0.0, `google-adk` 2.11.0, `google-genai` 2.28.0, `a2ui-agent-sdk` 0.2.4 and `ag-ui-a2ui-toolkit` 0.0.4 were installed by uv from `https://pypi.org/simple`, with no `direct_url`.
- **Toolchain.** The UI lock was generated with Node v24.11.0 / npm 11.6.1, as LGTS and LGP did. `npm ci`, the stack, the runner, `next build`, the validators, the setup reproduction and the docs checks ran on Node v22.16.0 / npm 10.9.2. Python is a uv 0.11.7 venv on host CPython 3.12.6 (the Dockerfile uses 3.12.13). `@copilotkit/aimock` 1.37.4.
- **One stack at a time.** Only this stack, its AIMock and the scratch AIMocks below ran. Port 3000 was never touched.

## 1. Dependencies

### Python (`requirements.txt`, `adk-python-install-20261006.log`)

Resolved with `uv pip install -r requirements.txt --exclude-newer 2026-10-05T21:00:00Z --index-url https://pypi.org/simple` (the LGP bound) at 22:47Z.

- **All 73 resolved packages were dated individually** (`adk-python-resolution-20261006.json`): **0 violations**. The youngest is `aiohttp` 3.14.4, at 29.2 h.
- **The PyPI survey** (same file) shows no direct package with a release after the bound, so the bound held nothing back. Every target is at least 100 h old.
- **`uv pip check`:** all 73 compatible.

| Package             | Before (09-23) | After                   | Published (UTC)  | Note                                                                             |
| ------------------- | -------------- | ----------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `google-adk`        | 2.9.2          | **2.11.0**              | 2026-10-02 00:46 | latest                                                                           |
| `google-genai`      | 2.25.0         | **2.28.0**              | 2026-10-02 17:58 | latest; google-adk needs `>=2.19,<3`                                             |
| `ag-ui-adk`         | 0.7.0          | **0.7.1**               | 2026-10-01 16:21 | latest; needs `a2ui-agent-sdk>=0.2.4,<0.3.0`                                     |
| `a2ui-agent-sdk`    | 0.2.4          | 0.2.4                   | 2026-06-03 23:09 | the only release in ag-ui-adk's range (0.3.0–0.7.0 exist)                        |
| `ag-ui-protocol`    | 0.1.22         | **1.0.0**               | 2026-09-17 18:31 | AG-UI 1.0, now supported by CopilotKit 1.77.0                                    |
| `fastapi`           | `>=0.141.1`    | `>=0.141.1` (0.141.1)   | 2026-07-29 17:18 | 0.142.x needs `opentelemetry-api>=1.44`; google-adk 2.11.0 caps it at `<=1.42.1` |
| `uvicorn[standard]` | `>=0.53.0`     | **`>=0.54.0`** (0.54.0) | 2026-09-25 06:52 | floor = what resolves                                                            |

Key transitive packages: `ag-ui-a2ui-toolkit` 0.0.4, `a2a-sdk` 1.2.2, `starlette` 1.7.0, `sse-starlette` 3.5.0, `opentelemetry-api` 1.42.1. The comments in `requirements.txt` now say AG-UI 1.0 is supported and why fastapi stays on 0.141.

### JS (`package.json`, `package-lock.json`)

- **`package.json`:** every `@copilotkit/*` pin (a2ui-renderer, react-core, runtime, shared, voice) goes to exactly **1.77.0**, `@ag-ui/client` to exactly **1.0.1**, and `next` to `^15.5.27`. `@ag-ui/client` and `@ag-ui/core` **overrides at 1.0.1** are added.
- **The overrides are needed.** A probe resolution without them (same command, temp copy) left **0.0.59** copies of `@ag-ui/core` and `@ag-ui/client` under `@copilotkit/channels-core`, `-intelligence`, `-slack` and `-teams` (`adk-ui-lock-update-20261006.log`), the same finding as LGTS and LGP. There was no stale override to remove.
- **Lock generated fresh:** `rm -rf node_modules package-lock.json && npm install --package-lock-only --legacy-peer-deps --before=2026-10-05T12:00:00Z` (the LGTS/LGP bound, which excludes `@ag-ui/*` 1.0.2). 901 entries, 0 peer-flagged, all from the registry. Legacy-peer mode, as on 09-23, because the Dockerfile runs `npm ci --legacy-peer-deps`.
- **Age audit (`adk-ui-lock-age-audit-20261006.json`, script `lgts-lock-age-audit.mjs`):** 109 entries added or changed, **0 violations**, 0 exotic sources. The youngest is `@modelcontextprotocol/sdk` 1.32.1, at 35 h.
- **`npm ci --legacy-peer-deps`** added 844 packages, exit 0 (`adk-ui-npm-ci-20261006.log`).
- **Duplicate copies (`adk-dependency-tree-20261006.log`):** each has exactly **one** copy, and `npm ls` shows every `channels-*` edge as `overridden` to 1.0.1:
  - `@copilotkit/core`, `shared`, `runtime`, `react-core` 1.77.0;
  - `@ag-ui/core`, `client`, `encoder`, `proto` 1.0.1; `@ag-ui/langgraph` 0.0.44;
  - `@langchain/core` 1.2.14 (a runtime transitive; ADK has no LangChain agent);
  - `next` 15.5.27, `react` / `react-dom` 19.3.0.

## 2. Static checks (what Showcase CI runs for this integration)

For ADK, CI runs the Docker build (`npm ci --legacy-peer-deps`, `npm run build`, `pip install -r requirements.txt`), the `showcase_validate.yml` validators and its `python-unit-tests` job, which collects ADK's `tests/python/`.

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileall -f src tools/ _shared/`                                                                     | **Pass** (`adk-python-static-20261006.log`).                                                                                                                                                                                                                           |
| Import every agent module, then `agent_server`, as uvicorn does (`adk-import-agents.py`)                | **31/31** modules import; **41/41** `AGENT_REGISTRY` entries are `LlmAgent`s mounted as `POST /<name>`. `declarative_gen_ui` has **0 tools**.                                                                                                                          |
| `uv pip check`                                                                                          | **Pass**, 73 packages.                                                                                                                                                                                                                                                 |
| `pytest tests/python/` (CI's command; test deps in a separate `--target` dir, bounded)                  | **80/80** (`adk-python-pytest-20261006.log`). CI's 3.10 leg was not reproduced (no local 3.10); the guide's 3.10 floor resolves (§6).                                                                                                                                  |
| `next build`                                                                                            | **Pass**. Next 15.5.27, 57 static pages, 35.1 s, max RSS 3.15 GB. Warnings: the known hashbrown and `@copilotkit/runtime` `channel-manager.mjs` / `fetch-handler.mjs` `Critical dependency` lines and the workspace-root inference (`adk-ui-next-build-20261006.log`). |
| `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends`, `validate-fixture-tool-surface` | **Pass** (`adk-ci-validators-20261006.log`). ADK: 38 demos, 37 specs, 35 QA files, the same 8 pre-existing warnings.                                                                                                                                                   |
| `validate-pins` ratchet                                                                                 | **Red before and after, not fixed.** FAIL **47 → 47**, WARN 2 → 2; baseline 26. ADK's five `@copilotkit/*` lines change 1.73.3 → 1.77.0 against the canonical 1.68.2, so the FAIL hash changes. Pre-update count from a `git archive` of `3e043e217a`.                 |

## 3. Boot (documented default command, strict AIMock)

- **AIMock.** The 09-23 command and flags (`--strict --validate-on-load --chunk-size 8 --latency 60`, `AIMOCK_STRICT_TURN_INDEX=1`, no record, proxy or provider flags). It loaded **9056** fixtures with no validation errors (`adk-aimock-20261006.log`).
- **Stack.** The documented `npm run dev` (`next dev --turbopack` + `uvicorn agent_server:app --reload` on 8000), with the venv first on `PATH`, on port 3103, in the 09-23 environment (`adk-stack-20261006.sh`, `adk-dev-stack-20261006.log`). `.next` was removed first, as on every later boot.
  - Agent `/health` and UI `/api/health` returned 200 after 3 s. FastAPI lists **42** `POST` routes (41 agents + `/agents/state`).
  - The runtime's `info` reports **1.77.0** with **40** agents (`a2ui_recovery` is served by its own route).
- **Pre-warm** (`adk-prewarm-20261006.log`): all 40 demo pages return 200. The API codes match 09-23: 200 for `/api/copilotkit` and `/api/health`, 405 on GET for the 10 POST-only runtimes, 401 for auth, 404 for voice, 403 for debug.
- **`/api/smoke`** (`adk-smoke-route-20261006.log`): 200 `ok` in 2.4 s through a real AG-UI 1.0 run; one request (200) matched the shared "Respond with exactly: OK" fixture.

## 4. Full strict D6 matrix

The runner command is the 09-23 one, with `--demos <batch>` (`adk-stack-20261006.sh d6`):

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts google-adk --demos <batch>
```

- **Batching.** The 09-23 ADK split (22 + 10 + 8) peaked at 10.38 GB, and LGTS hit the 10.5 GB abort line with the same 22-check batch today. The matrix therefore ran as the LGTS/LGP **five batches**, adjusted to ADK's manifest (no `tool-rendering-reasoning-chain`; `gen-ui-interrupt` added to B3).
- **Each batch** ran as one runner at `FEATURE_CONCURRENCY_D6=4`, on its own fresh boot (`.next` removed, the batch's pages and every API route pre-warmed, the AIMock journal reset).

| Batch | Features                                                                                                                                       | Checks | Result (driver, requests) |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------- |
| A1    | `beautiful-chat`, `cli-start`, `agentic-chat`, `prebuilt-sidebar`, `prebuilt-popup`, `chat-slots`, `chat-customization-css`, `headless-simple` | 11     | 11/11, 27.8 s, 17 req     |
| A2    | `headless-complete` … `hitl-in-app`, `hitl-in-chat`, `declarative-gen-ui`, `a2ui-fixed-schema`, `a2ui-recovery`                                | 11     | 11/11, 31.2 s, 46 req     |
| B1    | `mcp-apps`, `gen-ui-agent`, `tool-rendering-default-catchall`, `-custom-catchall`, `tool-rendering`                                            | 5      | 5/5, 14.4 s, 33 req       |
| B2    | `shared-state-read`, `-read-write`, `-streaming`, `readonly-state-agent-context`, `subagents`, `multimodal`                                    | 6      | 6/6, 21.0 s, 21 req       |
| B3    | `auth`, `declarative-hashbrown`, `declarative-json-render`, `open-gen-ui`, `-advanced`, `voice`, `agent-config`, `gen-ui-interrupt`            | 7      | 7/7, 54.7 s, 17 req       |

|                   | Checks | Pass | Fail | Skipped |
| ----------------- | ------ | ---- | ---- | ------- |
| Raw matrix        | 40     | 40   | 0    | 0       |
| Published catalog | 40     | 40   | 0    | 0       |

- **Run:** 22:55:51–23:00:49Z at `e737fc702f`. Per-check results and durations are in `adk-runtime-matrix-20261006.json`; logs are `adk-d6-full-<batch>-20261006.log`, `adk-dev-stack-full-<batch>-…`, `adk-prewarm-full-<batch>-…`.
- **Failures and reruns: none.** 0 `feature-retry` events.
- **Mapping** is unchanged from 09-23: 38 manifest features, `cli-start` has no D6 type, `beautiful-chat` expands into 5 checks, and `declarative-hashbrown` + `declarative-json-render` fold into `byoc` (which navigates only to `declarative-hashbrown`, so **`declarative-json-render` is routed but not directly exercised**). All 40 checks map to shipped demos.
- **Journals** (`adk-d6-journal-full-<batch>-20261006.json`): 134 requests (17 + 46 + 33 + 21 + 17), 131 `streamGenerateContent` and 3 `generateContent`, all `gemini-3.1-flash-lite`, **all 200**. Every request, including the 8 inner A2UI sub-agent calls, carries `x-aimock-strict: true`, `x-aimock-context: google-adk` and `x-test-id`.
- **AG-UI 1.0:** no event- or message-shape breakage. Every run, frontend-tool round trip, state snapshot and activity (A2UI) cell passed on `ag-ui-protocol` 1.0.0 → `@ag-ui/client` 1.0.1.
- **Stack logs:** no HTTP 500 and no `unhandledRejection`. The only Python tracebacks are the known non-fatal OpenTelemetry `Failed to detach context` pairs (34, the same count as 09-23), and the import-time `install_httpx_hook` warning for `Gemini` is unchanged.
- **Policy-excluded and untested:** `interrupt-headless`, `reasoning-default-render`, `agentic-chat-reasoning` (`not_supported_features`). `tool-rendering-reasoning-chain` is routed but not in the manifest's `features`.

## 5. The rechecks asked for

### `shared-state-read`: green and gated on both turns

- **Full run:** passed in 13.8 s on its first attempt. Both requests carry **"Lemon Saffron Orzo"** in the system instruction (roles `system,user` and `system,user,assistant,user`) and matched the two gated fixtures (`systemMessage: "Lemon Saffron Orzo"`, turn 1 with `turnIndex: 0`), both 200.
- **RED** (`adk-d6-redgreen-ssr-red-20261006.log`, journal alongside). The 09-23 revert of `d9467aa407` (`adk-shared-state-read-red-revert-20260923.diff`, which maps the cell to `_simple_chat`) was applied uncommitted, on a fresh boot. `--demo shared-state-read`: **fail**, `waitForTurnComplete: turn 1 did not complete within 57246ms (reason=dom-missing …)` on both attempts. 4 requests, all with the simple chat prompt "You are a helpful, concise assistant…", **all 503**.
- **GREEN** (`adk-d6-redgreen-ssr-green-20261006.log`). `registry.py` restored (`git status` clean), uvicorn reloaded, same boot and runner: `shared-state-read` 12.8 s with both gated fixtures matched, plus `shared-state-write` 9.4 s, `readonly-state-context` 8.0 s and `shared-state-streaming` 12.5 s. 12 requests, all 200, 0 retries.

### HITL cells keep the tool-based framing

| Check (demo)                        | Frontend hook                                   | Journal                                                                                              |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `hitl-approve-deny` (`hitl-in-app`) | async `useFrontendTool` `request_user_approval` | turn 1 returns a `request_user_approval` call; turn 2 carries `{"approved":true}` as the tool result |
| `hitl-text-input` (`hitl-in-chat`)  | `useHumanInTheLoop` `book_call`                 | `book_call` call, then the picked slot (`chosen_time`, `chosen_label`) as the tool result            |
| `gen-ui-interrupt`                  | `useHumanInTheLoop` `schedule_meeting`          | two meetings, each a `schedule_meeting` call followed by the chosen slot as its tool result          |

No D6 page uses `useInterrupt` (only the unlisted `/demos/hitl` does; `gen-ui-interrupt` mentions it in a comment), and no interrupt event is involved.

### `mcp-apps`

Passed in 6.0 s. The agent's request advertises `create_view`, discovered from the live `https://mcp.excalidraw.com/mcp`, and matched `{userMessage, toolName: "create_view", context}` with all forwarded headers.

### A2UI: `gen-ui-declarative` (dynamic schema) and the `generate_a2ui` pattern

**How ADK wires it.** In 1.77.0 the runtime's A2UI middleware (`@ag-ui/a2ui-middleware` 0.0.10), when `injectA2UITool` is on, adds `render_a2ui` to `tools` and forwards `injectA2UITool`. `ag-ui-adk` 0.7.1's `plan_a2ui_injection` then injects its own `generate_a2ui` (a `render_a2ui` sub-agent with the toolkit recovery loop) and drops the frontend `render_a2ui`, unless the agent already has a `generate_a2ui` ("user prevails"). This is the same contract as `copilotkit` (Python) in LGP.

**The LGP pattern is absent.**

- `declarative_gen_ui_agent.py` is a plain `LlmAgent` with `tools=[]`; the import check confirms 0 tools. No ADK agent defines a `generate_a2ui` stub.
- `beautiful_chat` and `a2ui_recovery` own a real `generate_a2ui` (`get_a2ui_tool`), and their routes set `injectA2UITool: false`, so nothing is injected on top of it. `a2ui_fixed_schema` also sets it false.
- **The shipped fixtures already run the three-call flow.** In the matrix journal (A2), each of the 4 pills is outer `{userMessage, context}` → `generate_a2ui` (tools `[generate_a2ui]` only, so the context-free `toolName: render_a2ui` fixture cannot match it), then the inner sub-agent call matched by `{userMessage, toolName: "render_a2ui"}`, then the outer `{context, toolCallId}` follow-up. `a2ui-recovery` shows the same shape with 1 and 3 inner attempts. The inner bodies are not journaled (AIMock truncates large bodies), but their headers are.

**Proof with a fixture that calls `generate_a2ui`** (`adk-a2ui-live-order-fixtures-20261006.json`, a scratch strict AIMock on :4411, the stack's `GOOGLE_GEMINI_BASE_URL` pointed there; same runner and probe). The set holds the same responses as ADK's `gen-ui-declarative.json`, reordered: follow-ups first, then the outer call **gated on the agent's instruction** (`systemMessage: "embedded sales analyst for Vantage Threads"`) answering `generate_a2ui`, then the inner `render_a2ui`. No context-free `render_a2ui` fixture precedes the outer one.

| Run (same boot, `--demo declarative-gen-ui`)                                                  | Result                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GREEN at `e737fc702f` (`adk-d6-a2ui-live-green-20261006.log`)                                 | **Pass, 11.4 s.** 12 requests, all 200: per pill, the gated outer call → `generate_a2ui`, the inner `render_a2ui` sub-agent call, then the `toolCallId` follow-up. All 12 carry the three headers.                                          |
| Negative control 1: stub as a plain function (`adk-a2ui-stub-negative-control-20261006.diff`) | **Pass**, but the outer requests advertise `generate_a2ui` **twice**. The adapter's "user prevails" check did not see the stub and injected a second tool; the injected one ran, so the stub never raised. This is an upstream bug (below). |
| Negative control 2: stub as `FunctionTool` (`adk-a2ui-stub-negative-control2-20261006.diff`)  | **Fail**, as LGP did: `waitForTurnComplete: turn 1 did not complete within 90000ms (reason=surface-missing …)` on both attempts. Only the 3 outer calls reached AIMock, and the stack log shows `generate_a2ui called directly` 21 times.   |
| GREEN again after `git checkout` of the agent (`adk-d6-a2ui-live-green2-20261006.log`)        | **Pass, 11.0 s**, the same 12-request three-call flow.                                                                                                                                                                                      |

The stubs were never committed; `git status` was clean after each restore. So the scratch set does catch the LGP pattern, and HEAD does not have it. **No ADK change was needed.**

## 6. Bring-your-own setup reproduction (`/google-adk/quickstart`, "Use an existing agent")

Scripts: `reproduce-adk-byoc-setup.sh` (bound and completeness check updated), `extract-adk-quickstart.py` and `adk-byoc-runtime-run.mts` (unchanged). Log: `adk-byoc-setup-20261006.log`, exit 0.

- **The extractor still finds every block.** The ADK quickstart has no language tabs; the per-step tabs added on 09-30 were LangGraph-only. Its only Tabs in the option are the `package-manager` group on "Start your UI". The script now counts the option's raw fenced blocks and fails if the extractor returns fewer: **20 of 20**. No fenced block sits outside the two options in "Getting started".
  - This guards the extractor's parsing, not the option boundary. The boundary (`id="bring-your-own"` to its `</TailoredContentOption>`) was checked by reading the page.
- **What changed in the guide since 09-23:** only the npm line, now `npm install @copilotkit/react-core @copilotkit/runtime @ag-ui/client@1.0.2` (`cdacc94932`, `61c5beb06c`). The default bound moved to `2026-10-05T21:00Z`, since `@ag-ui/client` 1.0.2 was published at 10-05 14:21Z and an earlier `--before` cannot install the guide's line.

| Step / variant                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prerequisites ("Python 3.10+")                  | **PASS**: the guide's `uv add` resolves at `requires-python >=3.10` (ag-ui-adk 0.7.1, ag-ui-protocol 1.0.0, google-adk 2.11.0, google-genai 2.28.0).                                                                                                                                                                                                                                                             |
| **as written**                                  | **PASS.** uv resolved ag-ui-adk 0.7.1, google-adk 2.11.0, google-genai 2.28.0, ag-ui-protocol 1.0.0, fastapi 0.141.1, uvicorn 0.54.0. `openapi.json` 200 after 4 s (IPv4 and IPv6). npm: runtime 1.77.0, top-level `@ag-ui/client` **1.0.2**. `info` 200 with `my_agent`; `agent/my_agent/run` 200 → `RUN_STARTED … TEXT_MESSAGE_* … STATE_SNAPSHOT RUN_FINISHED`, one `gemini-2.5-flash` request matched (200). |
| `+ @ag-ui/client@1.0.1` (the runtime's own pin) | **PASS**, identical event sequence.                                                                                                                                                                                                                                                                                                                                                                              |

- **Three AG-UI versions on the as-written install.** The route's `HttpAgent` comes from the guide's top-level `@ag-ui/client` 1.0.2; runtime 1.77.0 nests its pinned 1.0.1; `channels-*` 0.11.0 nest 0.0.59. A text run works across them. The pin follows `packages/runtime` on `main` (1.0.2, enforced by `ag-ui-install-pin.test.ts`), which is ahead of the published 1.77.0. That is a fleet-wide docs decision, so it was not changed here.
- **No guide change was needed.** Not reproduced: the Next.js scaffold and React files, `npx copilotkit@latest project select` and the Intelligence key (the route ran with the guide's no-Intelligence callout applied), and the pnpm/yarn/bun tabs. Python 3.10 is proven at resolver level only.

## 7. Docs checks

These ran under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock` at `e737fc702f`, with the stack stopped:

- `npm run pretypecheck && npm run typecheck`: **pass** (`adk-qual-shell-docs-typecheck-20261006.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (`--maxWorkers=1 --execArgv=--max-old-space-size=4096`): **25/25** (`adk-qual-guard-bindings-20261006.log`).
- `current-v2-authored-guides` + `llm-text` (same flags): **2 files, 72/72** (`adk-qual-docs-tests-20261006.log`).
- Generation changed no tracked file. This run changed no docs source or docs region.

## Commits

| SHA          | Subject                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `e737fc702f` | chore(showcase): update Google ADK to CopilotKit 1.77.0 and AG-UI 1.0                          |
| `cf3b79c0f5` | test(audit): bound the ADK setup reproduction for @ag-ui/client 1.0.2 and check block coverage |

This record, its scripts and logs are committed after them. **Shared sources: none changed.** Only `showcase/integrations/google-adk/{package.json,package-lock.json,requirements.txt}` and `tasks/` changed, so no other integration is affected.

## Upstream findings (not filed; drafts for a human)

1. **`ag-ui-adk` 0.7.1: the A2UI "user prevails" check misses a `generate_a2ui` declared as a plain function.**
   - `ADKAgent` builds `existing_tool_names` with `getattr(tool, "name", None)` over `LlmAgent.tools` (`adk_agent.py` ~line 3224). A plain Python function, the usual way to declare an ADK tool, has `__name__` but no `.name`, so `plan_a2ui_injection` injects a second `generate_a2ui`. The request then declares the function twice; the dev's tool is silently shadowed.
   - **Repro:** `adk-a2ui-user-prevails-repro.py` (log `adk-a2ui-user-prevails-repro-20261006.log`): plain function → `existing_tool_names=[]` → injects; `FunctionTool` → `['generate_a2ui']` → skips. End to end: negative control 1 above (two `generate_a2ui` declarations in every outer request).
   - **Suggested fix:** also read `getattr(tool, "__name__", None)` for callables (or normalise through `FunctionTool`). Real Gemini may reject the duplicate declaration; that was not tested live.
2. **`@copilotkit/runtime` 1.77.0 pulls two AG-UI versions** (`channels-*` 0.11.x pin 0.0.59). Unchanged from the LGTS/LGP records; ADK needs the same overrides.

## Remaining defects and notes

1. **`validate-pins` is red**: 47 FAILs against a baseline of 26; the canonical pin is still 1.68.2. Count unchanged; the hash changes.
2. **The context-free inner A2UI fixtures** (`{userMessage, toolName: "render_a2ui"}`) remain a fleet-wide hazard, as the LGP record says. They do not hide anything in ADK today, because ADK's outer call never advertises `render_a2ui`.
3. **The quickstart's `@ag-ui/client@1.0.2`** is ahead of the published runtime's 1.0.1 (§6). It works for a text run.
4. **Carried over from 09-23:** the smoke-route fix is still only in 3 of 21 integrations; `tool-rendering-reasoning-chain` is routed but not in `features`; the unlisted `/demos/hitl` imports `useInterrupt`; the OpenTelemetry detach tracebacks and the `install_httpx_hook` warning; the Docker build floats Python transitives (`fastapi`, `uvicorn`, `python-dotenv`, `pydantic` are not exact).
5. **Not exercised:** `declarative-json-render` (routed only) and the three `not_supported_features`.

## Resources

- **Load.** Every heavy step ran under `nice -n 10`, one stack at a time. A wait-for-load gate (≤ 15) ran before each boot and each runner and never had to wait. The maximum sampled 1-minute load was **10.21**; the highest reading outside the sampler was 13.86, during `npm ci`.
- **RSS** was sampled every 2 s over the descendants of AIMock, each stack boot, each runner (with Playwright's Chromium) and the scratch AIMock (`adk-rss-20261006.log`, `adk-rss-sampler-20261006.sh`, abort line 10.5 GB). `next build`, the setup reproduction and the docs checks ran outside it with no stack up.

  | Phase                                | Peak (sum of RSS)                       | Largest process            |
  | ------------------------------------ | --------------------------------------- | -------------------------- |
  | Boot 1 + all-40-pages pre-warm       | 7,086,864 KiB = 7.26 GB                 | `next-server` 6.73 GB      |
  | Matrix A1 / A2 / B1 / B2 / B3        | 7.54 / **8.34** / 6.99 / 7.55 / 5.90 GB | `next-server` 5.80 GB (A2) |
  | A2UI order check + negative controls | 5.26 GB                                 | `next-server` 3.70 GB      |
  | `shared-state-read` red/green        | 6.90 GB                                 | `next-server` 4.44 GB      |

  The figure sums RSS, so shared Chromium pages are counted more than once.

## Limitations

- **AIMock replay is not live Gemini.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures, not model quality or real Gemini behaviour (including whether Gemini accepts the duplicate `generate_a2ui` declaration in upstream finding 1). The A2UI order proof stands in for a live model with an instruction-gated scratch fixture set. `voice` covers the bundled transcript handoff, and `multimodal` the sample button.
- **Host-native, not Docker.** Host Node 22.16.0 and a uv venv on CPython 3.12.6; the image's Python 3.12.13, `pip install`, `entrypoint.sh` and `next start` were not booted. The Dockerfile path was checked by host `next build` and `npm ci --legacy-peer-deps`. CI's Python 3.10 pytest leg was not reproduced.
- **MCP Apps needs a live external server.** `mcp-apps` and Beautiful Chat's Excalidraw tools discover `create_view` from `https://mcp.excalidraw.com/mcp` even under strict replay, so those cells are not hermetic.
- **The matrix is five runner processes on five boots,** forced by the RSS cap.
- **The setup reproduction proves the agent and the guide's route** with one text run on Python 3.12. The Next.js app, React files, Intelligence path and other package-manager tabs were not reproduced.

## Cleanup

- Every stack boot (the `npm run dev` process group), AIMock (:4410) and the scratch A2UI AIMock (:4411) were stopped with SIGTERM to their own process groups. The RSS sampler was stopped, and every runner exited on its own. One scratch-AIMock start command (a zsh subshell) never launched its server and was stopped as a task; nothing was listening.
- The setup script stopped its agents and its scratch AIMock (`port 8000 after stop: free`) and removed its `/private/tmp/adk-byoc-setup.*` directory. The `validate-pins` archive directory was removed.
- **Ports** 3103, 4410, 4411, 4412 and 8000 are free. Port 3000 was never touched. No `uvicorn`, `llmock`, `run-local-d6` or runner-owned Chromium process remains.
- **Left in place:** the ignored `.next/` and regenerated `node_modules/` in `showcase/integrations/google-adk`. The venv, the pytest target and the scratch fixture copy are in the session scratchpad.
