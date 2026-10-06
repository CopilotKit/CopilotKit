# LangGraph TypeScript: requalification on published CopilotKit 1.77.0 and AG-UI 1.0.1 (2026-10-06)

**Verdict: qualified, 40 of 40 after one fix.** The first full strict D6 run passed **39 of 40** (raw and published). The one failure was `gen-ui-declarative`. It failed the same way on its rerun, and its root cause is a behaviour change in 1.77.0 that exposed a missing header forward in one LGTS graph. After the fix, a second full run on fresh boots passed **40 of 40**, every check on its first attempt.

Three more defects were found and fixed outside the matrix:

- **The production agent could not boot.** A version guard in the persistence preload rejected every `@langchain/langgraph-api` other than 1.1.17, and CI's behavioral pytest failed. This has been true since the 2026-09-23 update.
- **The quickstart's TypeScript existing-agent steps were unreachable.**
- **The Zod note named an old SDK version.**

The cells that needed fixes before (`mcp-apps`, `shared-state-read`, `tool-rendering*`, `gen-ui-agent`) are green on the first run. The two `@langchain/openai` behaviours behind their 09-23 root causes were rechecked on 1.6.2 and are unchanged. The 09-23 fixture and model choices still neutralise them.

|                                   | Result                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First run (raw / published)       | **39/40 / 39/40**. Fail: `gen-ui-declarative` (`waitForTurnComplete … reason=dom-missing`), 20 strict 503s. Rerun: same failure, 13 strict 503s.                                                   |
| Final run (raw / published)       | **40/40 / 40/40** at `bb1ae7bfdc`. 0 feature retries; 142 AIMock requests, all 200, 0 strict 503s.                                                                                                 |
| `gen-ui-declarative` red/green    | RED in the matrix and on its rerun → GREEN in 16.7 s → 9 neighbouring checks green (`a2ui-fixed-schema`, `a2ui-recovery`, `byoc`, 5 × `beautiful-chat`, `agentic-chat`).                           |
| Production agent boot / CI pytest | RED: `npm start` exits in 2 s; pytest 22/24 → GREEN: 29 graphs on 8123 in 3 s; pytest **24/24** with `LGT_REQUIRE_BEHAVIORAL=1`.                                                                   |
| Static checks                     | Strict `graph.ts` tsc, `next build`, `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends` and `validate-fixture-tool-surface` pass. `validate-pins` stays red at 47 (Δ 0 count). |
| Bring-your-own setup              | RED: TypeScript readers saw no agent file, route or start command → guide fixed → GREEN: all three phases pass, including a `RUN_FINISHED` run through the guide's own route.                      |
| Docs checks (under the lock)      | pretypecheck and typecheck pass; guard 25/25; `current-v2-authored-guides` + `llm-text` + `langgraph-typescript-doc-regions` 86/86.                                                                |
| Peak audit RSS                    | **10.52 GB** (10,273,824 KiB), in an aborted single-boot batch. The batched runs peaked at **9.94 GB**. Under the 11 GB cap.                                                                       |

## Provenance

- **Worktree:** `tyler/docs-feature-audit`, rebased onto `origin/main` on 2026-10-06. It started at `a7e2c82dcc` with a clean tree, and `git pull --ff-only` was a no-op.
- **CopilotKit is unpatched and comes from the registry.** Every `@copilotkit/*` package is 1.77.0, resolved from `registry.npmjs.org` (the lock has no `link:`, `file:` or git sources). The lock age audit found 0 exotic sources.
- **Toolchain.**
  - The locks were generated with Node v24.11.0 / npm 11.6.1, as on 09-23.
  - `npm ci`, the stack, the runner, the builds and the setup reproduction ran on Node v22.16.0 / npm 10.9.2 (the Dockerfile's `node:22` major).
  - `@copilotkit/aimock` is 1.37.4, the Showcase pin.
- **One stack at a time.** Nothing else was listening on 3101, 4410, 4411, 4412, 8123, 8124 or 2024. Port 3000 was never touched.

## 1. Dependencies

Locks were regenerated fresh (`rm -rf node_modules package-lock.json && npm install --package-lock-only --before=2026-10-05T12:00:00Z`, `lgts-{ui,agent}-lock-update-20261006.log`). The bound is 32.5 h before the run. It excludes `@ag-ui/core`/`client` 1.0.2 (10-05 14:21Z), `@ag-ui/langgraph` 0.0.45 and `@langchain/core` 1.2.16/1.2.17 (10-06).

**Age audit (`lgts-lock-age-audit-20261006.json`, script `lgts-lock-age-audit.mjs`).** Every added or changed `name@version` was checked:

- **Agent:** 35 added or changed. **0 violations**, 0 exotic sources. The youngest is `nanoid` 3.3.20 at 34.8 h.
- **UI:** 112 added or changed. **0 violations**, 0 exotic sources. The youngest is `@modelcontextprotocol/sdk` 1.32.1 at 32.8 h.

`npm ci` on Node 22 added 885 (UI) and 253 (agent) packages. The Dockerfile's `npm ci --legacy-peer-deps` passes as a dry run for both (`lgts-{ui,agent}-npm-ci-20261006.log`).

| Package                                                          | Before (09-23)           | After                   | Published (UTC)  |
| ---------------------------------------------------------------- | ------------------------ | ----------------------- | ---------------- |
| `@copilotkit/*` (runtime, react-core, sdk-js, shared, core, …)   | 1.73.3                   | **1.77.0**              | 2026-10-02 21:33 |
| `@ag-ui/core` / `client` / `encoder` / `proto`                   | 0.0.59                   | **1.0.1**, single copy  | 2026-09-29 09:45 |
| `@ag-ui/langgraph`                                               | 0.0.43 UI + 0.0.42 agent | **0.0.44** both, single | 2026-10-01 16:14 |
| `@langchain/core`                                                | 1.2.12                   | **1.2.14**, single copy | 2026-10-01 01:19 |
| `@langchain/langgraph`                                           | 1.4.17                   | **1.4.19**, single copy | 2026-10-03 18:39 |
| `@langchain/langgraph-sdk`                                       | 1.11.2                   | **1.12.1**              | 2026-10-03 18:39 |
| `@langchain/langgraph-api` / `-cli` (and the `dev` scripts' pin) | 1.5.0                    | **1.5.2**               | 2026-10-03 18:40 |
| `@langchain/openai` (pulls `openai` 7.28.0)                      | 1.5.13                   | **1.6.2**               | 2026-10-01 14:15 |
| `langchain`                                                      | 1.5.12                   | **1.5.15**              | 2026-10-01 01:17 |
| `next` / `react` / `react-dom`                                   | 15.5.26 / 19.3.0         | **15.5.27** / 19.3.0    | 09-30 / 09-09    |
| `@langchain/langgraph-checkpoint`, `@ag-ui/mcp-apps-middleware`  | 1.1.5 / 0.1.1            | unchanged               | 08-19 / 09-11    |

**Overrides.**

- **UI:** `@ag-ui/core`/`client` move from 0.0.59 to **1.0.1** and are kept. A probe resolution without them leaves 0.0.59 copies under `@copilotkit/channels-core`, `-intelligence`, `-slack` and `-teams`. Their 0.11.0, the only release `@copilotkit/runtime` 1.77.0 accepts, pins `@ag-ui/core`/`client` 0.0.59 exactly. See Upstream findings.
- **Agent:** a single 1.0.1 copy resolves without the overrides, so they were **dropped**. `@ag-ui/langgraph` goes to **0.0.44**, as asked. Note that `sdk-js` 1.77.0 already pins 0.0.44 exactly, so this override is currently a no-op.

**Duplicate copies** (`lgts-dependency-tree-20261006.log`): `@copilotkit/core`, `@copilotkit/shared`, `@ag-ui/core`, `@ag-ui/client`, `@langchain/core` and `@langchain/langgraph` each have exactly one copy in each package. The UI keeps its own `openai` 5.23.2 at the root and nests 7.28.0 under `@langchain/openai`.

## 2. Static checks (what Showcase CI runs for this integration)

| Check                                                                                                   | Result                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Strict `graph.ts` tsc (run b's flags)                                                                   | **Pass**, 1204 files (`lgts-graph-strict-tsc-20261006.log`).                                                                                                                                                                                                       |
| Informational: all graph modules, strict                                                                | 7 errors, down from 8. All 7 are pre-existing locations; the change is a source edit since 09-23, not this update (`lgts-all-graphs-strict-tsc-20261006.log`).                                                                                                     |
| `next build` (host equivalent of the Dockerfile build)                                                  | **Pass**. Next 15.5.27, 57 static pages, 32.8 s, max RSS 2.52 GB. The only warnings are the known hashbrown `Critical dependency` and workspace-root ones (`lgts-ui-next-build-20261006.log`).                                                                     |
| Informational: UI tsc (CI does not typecheck the UI)                                                    | 28 errors. Compared with 09-23 there are +7 `_shared/ts/cvdiag-emitter.ts` TS2307 errors, which come from the `_shared` symlink source change `c3f876bf73`. No new error names an `@copilotkit/*`, `@ag-ui/*` or `@langchain/*` type (`lgts-ui-tsc-20261006.log`). |
| `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends`, `validate-fixture-tool-surface` | **Pass**. Parity: 39 demos, 38 specs, 11 QA files, warnings all pre-existing. Symlinks: the `shared-tools` real directory is baselined (`lgts-ci-validators-20261006.log`).                                                                                        |
| `validate-pins` ratchet                                                                                 | **Red before and after.** FAIL count **47 → 47**: the seven LGTS `@copilotkit/*` lines change 1.73.3 → 1.77.0 against the canonical 1.68.2, so the FAIL hash changes. WARN 2 → 2. Baseline 26. Not fixed.                                                          |
| CI `python-unit-tests` for LGTS (`LGT_REQUIRE_BEHAVIORAL=1`)                                            | **RED → GREEN after a fix** (below): 22/24 → **24/24** (`lgts-python-unit-tests-{red,green}-20261006.log`).                                                                                                                                                        |

### Defect: the production agent refused to boot (fixed in `dfdd312f50`)

- **What CI and the Dockerfile run.** `entrypoint.sh` starts the agent with `npm start`, which runs `node --import ./disable-file-persistence.mjs …`. That preload refuses to boot unless `@langchain/langgraph-api` is exactly `EXPECTED_PKG_VERSION`, which was `"1.1.17"` (`origin/main` still pins 1.1.17).
- **RED** (`lgts-prod-agent-boot-red-20261006.log`):
  - At 1.5.2, `npm start` exited after 2 s with "version/shape guard failed: @langchain/langgraph-api is 1.5.2, but the fs-write interception was verified against 1.1.17".
  - The same preload against the 1.5.0 tarball that the **2026-09-23 update installed fails the same way** (exit 1). The production path has therefore been broken on this branch since `c0b57935cf`. The 09-23 records booted only `langgraph-cli dev`, which does not load this preload.
  - CI's behavioral pytest failed 2 of 24.
- **Re-verification** (`lgts-persist-writer-reverify-20261006.log`, `npm pack` of 1.1.17 and 1.5.2):
  - `dist/storage/persist.mjs` differs only by `let` → `const`. It keeps the namespace `import * as fs from "node:fs/promises"` and writes only through `fs.writeFile`/`fs.mkdir`.
  - The same two files contain write calls in both versions.
  - The same three `new FileSystemPersistence(` sites exist.
  - The one new `langgraph_api` match is a metadata key name.
- **Fix.** `EXPECTED_PKG_VERSION = "1.5.2"`, with the two comment references updated.
- **GREEN** (`lgts-prod-agent-boot-green-20261006.log`):
  - The agent binds 8123 and 8124 in 3 s and serves 29 assistants.
  - The persistence-dir writes are intercepted, and the binding identity is verified for 6 members.
  - pytest passes 24/24.

## 3. Boot (documented default command, strict AIMock)

- **AIMock.** Same command and flags as 09-23 (`--strict --validate-on-load --chunk-size 8 --latency 60`, `AIMOCK_STRICT_TURN_INDEX=1`, no record/proxy/provider flags). It loaded **9056** fixtures with no validation errors (`lgts-aimock-20261006.log`). The count rose from 8632 because fixtures were added since.
- **Stack.** `npm run dev`, now `next dev --turbopack` plus `langgraph-cli@1.5.2 dev --port 8123`, with the 09-23 environment on port 3101.
  - `.next` was removed first.
  - The agent and UI were up in 3 s, with **29 graphs**.
  - `info` reports runtime **1.77.0** and 31 agents (`lgts-dev-stack-20261006.log`).
- **Pre-warm.** All 41 demo pages returned 200. The API codes match 09-23 (`lgts-prewarm-20261006.log`).
- **`/api/smoke`.** Returned 200 `ok` in 3.2 s through a real AG-UI 1.0 run that reached `RUN_FINISHED`, with one `gpt-5-mini` request (200).

## 4. Full strict D6 matrix

The runner command is the 09-23 one, with `--demos <batch>` (`lgts-stack-20261006.sh d6`):

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-typescript --demos <batch>
```

Each batch ran as one runner at `FEATURE_CONCURRENCY_D6=4` on its own fresh boot: `.next` removed, the batch's pages and every API route pre-warmed, and the AIMock journal reset.

**Batching.** The ADK split (22 + 10 + 8) was tried first and hit the abort line:

- Batch A (the first 19 features, 22 checks, one boot) reached **10,273,824 KiB (10.52 GB)** at 20:48:23Z, with `next-server` at 6.66 GB and the runner plus Chromium at 1.76 GB.
- The sampler sent SIGTERM to the runner. 15 checks had passed. The other 7 then failed with "shared browser disconnected before context open", which are artefacts of the abort, not product results (`lgts-d6-full-A-aborted-20261006.log`).
- The matrix was therefore run as **five batches**: A1 (8 features), A2 (11), B1 (6), B2 (6) and B3 (7).

| Batch | Features                                                                                                                | Checks | First run (`dfdd312f50`)                  | Final run (`bb1ae7bfdc`) |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------- | ------------------------ |
| A1    | `beautiful-chat` … `headless-simple`                                                                                    | 11     | 11/11, 35.4 s, 17 req                     | 11/11, 37.0 s, 17 req    |
| A2    | `headless-complete` … `a2ui-recovery`                                                                                   | 11     | **10/11**, 207.1 s, 55 req (**20 × 503**) | 11/11, 40.4 s, 47 req    |
| B1    | `mcp-apps`, `gen-ui-agent`, `tool-rendering-default-catchall`, `-custom-catchall`, `tool-rendering`, `-reasoning-chain` | 6      | 6/6, 36.6 s, 43 req                       | 6/6, 36.5 s, 43 req      |
| B2    | `shared-state-read`, `-read-write`, `-streaming`, `readonly-state-agent-context`, `subagents`, `multimodal`             | 6      | 6/6, 42.1 s, 21 req                       | 6/6, 43.5 s, 21 req      |
| B3    | `auth`, `declarative-hashbrown`, `declarative-json-render`, `open-gen-ui`, `-advanced`, `voice`, `agent-config`         | 6      | 6/6, 55.2 s, 14 req                       | 6/6, 55.5 s, 14 req      |

|                   | Checks | First run | Final run |
| ----------------- | ------ | --------- | --------- |
| Raw matrix        | 40     | **39**    | **40**    |
| Published catalog | 40     | **39**    | **40**    |

- **Mapping.** It is unchanged from 09-23. `beautiful-chat` expands into 5 checks, and `cli-start` has no D6 type. `declarative-hashbrown` and `declarative-json-render` fold into `byoc`, which navigates only to `declarative-hashbrown`, so **`declarative-json-render` is routed but not directly exercised**. All 40 checks map to shipped demos, so the published count equals the raw count.
- **Policy-excluded and untested:** `gen-ui-interrupt` and `interrupt-headless` (`not_supported_features`).
- **Journals** (`lgts-d6-journal-full-*-20261006.json`).
  - First run: 150 requests, 130 × 200 and 20 × 503, all 20 from `gen-ui-declarative`.
  - Final run: 142 requests, **all 200**.
  - In the final run, every request except the 4 inner `render_a2ui` sub-agent calls of `gen-ui-declarative` carries `x-aimock-context: langgraph-typescript`. Those 4 match context-free fixtures.
  - **No Chat Completions response came from a fixture with `reasoning`.** All 8 reasoning fixtures went out over `/v1/responses` (the reasoning chain and `reasoning-*`).
- **Stack logs.** One non-fatal `unhandledRejection: SyntaxError: Unexpected end of JSON input` appeared while four `beautiful-chat` contexts loaded, in the final A1 only. Its checks passed. The `GET /api/copilotkit-beautiful-chat/info` 404s are the 09-23 pattern.

### The failure: `gen-ui-declarative` (fixed in `bb1ae7bfdc`)

- **Assertion.** Both in-matrix attempts failed with `waitForTurnComplete: turn 1 did not complete within 90000ms (reason=dom-missing, runsFinished=0, count=0, attrPresent=true, runningNow=true, runStartCount=1)`. **The rerun, on a fresh boot, failed identically**: 13 requests, all 503 (`lgts-d6-rerun-declarative-gen-ui-20261006.log`).
- **The journal could not show why.** The bodies were over 64 KB, so AIMock's journal truncated them, and the requests carried no `x-aimock-context`.
- **Diagnosis.** A diagnostic boot sent the agent's OpenAI calls through a byte-for-byte capture proxy (`lgts-capture-proxy-20261006.mjs` on :4412, forwarding to the same strict AIMock; `lgts-declarative-gen-ui-capture-red-20261006.json`). Every request had `tools: ["generate_a2ui"]` and **no `x-*` headers**.

**Root cause.**

1. **1.77.0 changed the tool the agent sees.** `@copilotkit/sdk-js` 1.77.0's `copilotkitMiddleware` adds an `"ag-ui"` field to its state schema. In 1.73.3 the schema had only `copilotkit`, so the `"ag-ui"` channel that `@ag-ui/langgraph` writes, including `inject_a2ui_tool`, was dropped. Now `effectiveProperties(state).inject_a2ui_tool` is truthy, the middleware injects the runtime's `generate_a2ui` (via `getA2UITools`), and it drops the frontend `render_a2ui` tool.
2. **The turn is now three calls**, as the ADK and LangGraph Python fixtures already describe:
   - an outer call, gated on `context`, that returns `generate_a2ui`;
   - an inner `render_a2ui` sub-agent call, gated on `toolName`;
   - an outer follow-up, gated on `context` and `toolCallId`.

   On 1.73.3 the agent called `render_a2ui` directly in a single context-free request. That is why it passed then: on 09-23 its one 76 KB request matched the `toolName: render_a2ui` fixture.

3. **`a2ui-dynamic.ts` was the one LGTS graph without header forwarding.** It used a plain `new ChatOpenAI`, so its outer calls carried no `x-aimock-context` and matched nothing under strict mode. This violates the checklist's per-request forwarding rule, and 1.73.3's single-request path had masked it.

**Fix.** `a2ui-dynamic.ts` gains a `showcaseGraph`, registered in `langgraph.json` and `server.mjs`, with a small `wrapModelCall` middleware.

- The middleware copies the forwarded `x-*` headers from `configurable.copilotkit_forwarded_headers` onto `modelSettings.headers`. This is the mechanism `copilotkitMiddleware` uses for its own forwarded headers.
- `createAgent` builds its model once, so `makeChatOpenAI(config)` cannot be used here.
- The public `graph` is unchanged and stays copy-pasteable.
- No fixture, probe or shared source changed, so no other integration is affected.

**Red/green on the same runner:**

| Run                                                             | Result                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED: matrix A2 and the rerun (fresh boot), at `dfdd312f50`      | Fail, as above. 20 and 13 strict 503s.                                                                                                                                                                                          |
| GREEN: `--demo declarative-gen-ui`, fresh boot, fix uncommitted | **Pass, first attempt, 16.7 s.** 12 requests, all 200. Four pills, each as the 3-call flow: context → `generate_a2ui`, no-context `render_a2ui`, then context + `toolCallId` (`lgts-d6-green-declarative-gen-ui-20261006.log`). |
| Neighbours, same boot                                           | **9/9 pass**, 0 retries: `gen-ui-a2ui-fixed`, `a2ui-recovery`, `byoc`, 5 × `beautiful-chat` and `agentic-chat` (`lgts-d6-regression-a2ui-neighbours-20261006.log`).                                                             |
| Final full matrix at `bb1ae7bfdc`                               | 40/40.                                                                                                                                                                                                                          |

The production boot with the new export registered also passes: 29 graphs (`lgts-prod-agent-boot-green2-20261006.log`).

## 5. The cells that needed fixes before, and `@langchain/openai` 1.6.2

All of these were green on the first run, on their first attempt:

| Cell                                                                          | First run                 | Evidence                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp-apps`                                                                    | 9.9 s                     | `create_view` discovered from the live `https://mcp.excalidraw.com/mcp`. The fixture is served without `reasoning`.                                                                                                          |
| `shared-state-read`                                                           | 16.0 s                    | Both turns on `gpt-4o-mini`, roles `system,system,user…`. Both system prompts contain **"Lemon Saffron Orzo"** and matched the gated fixtures (`systemMessage: "Lemon Saffron Orzo"`, turn 1 with `turnIndex: 0`), both 200. |
| `tool-rendering`, `-default-catchall`, `-custom-catchall`, `-reasoning-chain` | 6.2 / 9.9 / 14.3 / 26.5 s | `gpt-5.4` Chat Completions (no `reasoning` on that endpoint) plus 6 `/v1/responses` reasoning fixtures.                                                                                                                      |
| `gen-ui-agent`                                                                | 19.8 s                    | Uses `showcaseGraph` (`makeChatOpenAI`).                                                                                                                                                                                     |

**Explicit checks** (`lgts-langchain-openai-checks-20261006.mjs` / `.log`, standalone, using the agent's installed `@langchain/openai` 1.6.2, `@langchain/core` 1.2.14 and `openai` 7.28.0, with AIMock 1.37.4's own chunk builders and server):

1. **Role-less first chunk: unchanged in 1.6.2.**
   - A first delta of `{reasoning_content}` with no `role` still makes a **`generic`** chunk and a `generic` end message.
   - With content plus a tool call, or a tool call alone, the call survives only in `additional_kwargs.tool_calls` and `tool_calls` is null.
   - A text-only stream is `generic` too.
   - With `role` on the first delta, the message is `ai` and `tool_calls` is `["create_view"]`.

   The 09-23 fixture change (no `reasoning` on Chat Completions fixtures) is therefore still required. The journals confirm none are served.

2. **System prompts as `developer`: unchanged.**
   - `ChatOpenAI` sends a `SystemMessage` as **`developer`** for `gpt-5-mini` and `gpt-5.4`, and as `system` for `gpt-4o-mini` and `gpt-4.1`.
   - Strict AIMock 1.37.4's `systemMessage` matcher on `/v1/chat/completions` returns 200 for a `system` message and **503** for the same text as `developer`.

   `shared-state-read` must therefore stay on `gpt-4o-mini` until AIMock maps `developer`.

## 6. Bring-your-own setup reproduction (`/langgraph-typescript/quickstart`, "Use an existing agent")

The scripts are `reproduce-lgts-byoc-setup.sh` (rewritten), `extract-lgts-quickstart.py` and `lgts-byoc-runtime-run.mts`.

- **The extractor simulates the docs Tabs component.** All tabs with the same `groupId` share one selection. The page pre-selects TypeScript on `/langgraph-typescript/*`. The guide tells TypeScript readers to use the LangSmith route tab, and npm is assumed. The extractor lists the fenced blocks that reader can see; nothing is hand-copied.
- **Phases:**
  - `visible-path`: the agent, route and start command must all be visible.
  - `showcase-callout`: the "complete runnable Showcase agent" commands, run verbatim on a clone-equivalent copy.
  - `existing-agent`: the guide's own blocks, run in a fresh temp directory. `npm init -y` stands in for `create-next-app`. The route runs with the guide's no-Intelligence callout applied, and a single-route `info` plus `agent/run` go through the guide's `route.ts` with the guide's first prompt. The model call goes to a scratch strict AIMock on :4411.
- **Bounds:** `npm --before=2026-10-05T12:00Z` applies to the npm installs and npx.

### Defect: the TypeScript steps were unreachable

The "Use an existing agent" option wrapped its whole Python flow in an outer `language_langgraph_agent` tab whose TypeScript side held only the Showcase reference. The 09-30 per-step TypeScript tabs on `main` (`5895f8030c`) sat inside that outer Python tab. A TypeScript reader therefore saw no `src/agent.ts`, `langgraph.json`, route or start command. The LLM text, which flattens tabs, showed both paths.

| Run                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED (`lgts-byoc-setup-red2-20261006.log`)                                | `visible-path` **FAIL**: 5 visible blocks, and 5 TypeScript blocks hidden; agent code, graph registration, runtime route and start command are all MISSING. `showcase-callout` **PASS**: 29/29 graphs return 200. `existing-agent` **FAIL**: "no visible block matching `mkdir my-agent`".                                                                                                                                                          |
| Script corrections found on the way (`lgts-byoc-setup-red-20261006.log`) | The first attempt copied only the integration. Since `c3f876bf73` its `_shared` is a symlink to `../_shared`, which a real clone contains, so the copy failed with `Cannot find module '../../_shared/ts/a2ui/context'`. The script now also copies in-repo symlink targets. Each phase's subshell also lacked the EXIT trap, which left the scratch AIMock running; it was stopped, and the subshell now cleans up.                                |
| Fix (`7256775c4c`)                                                       | The outer wrapper (3 lines) was removed, so the per-step tabs and the shared frontend steps apply to both languages. The Showcase callout and reference snippets moved, nearly verbatim, into the TypeScript tab of "Expose your agent via AG-UI". The vague "connect your React app…" paragraph was dropped, because the guide's own route step follows. The Python path is unchanged apart from the outer switcher.                               |
| GREEN (`lgts-byoc-setup-green-20261006.log`)                             | `visible-path` **PASS**: 21 visible blocks, 0 hidden. `showcase-callout` **PASS**: agent up in 3 s, 29/29 graphs. `existing-agent` **PASS**: `@langchain/core` 1.2.14, `langgraph` 1.4.19 and `openai` 1.6.2; runtime 1.77.0; the guide's start block bound `[::1]:8123` in 6 s; `info` 200 with `sample_agent`; `agent/run` 200 → `RUN_STARTED … TEXT_MESSAGE_* … RUN_FINISHED` with the fixture's joke; one `gpt-4.1-mini` request matched (200). |

- **Duplicate `@ag-ui/core` copies on the unpinned path.** The guide's `npm install @copilotkit/react-core @copilotkit/runtime` installs **two** `@ag-ui/core` versions: 1.0.1, and 0.0.59 through the `channels-*` packages. The text run works; richer features on that tree are untested.
- **Zod note.** It now names `@copilotkit/sdk-js` 1.77.0, whose zod peer range is unchanged (`^3.23.3 || ^3.24.0 || ^3.25.0`). Rechecked (`lgts-zod-note-verify-20261006.log`):
  - `sdk-js@1.77.0 zod@3` installs 3.25.76.
  - A separate, unversioned `npm install zod` after the SDK gives 4.6.5 with only "ERESOLVE overriding peer dependency".
  - The SDK on a project already on Zod 4 fails with ERESOLVE.

## 7. Docs checks

These ran under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock` after the stack was stopped, at `7256775c4c`:

- `npm run pretypecheck && npm run typecheck`: **pass** (`lgts-qual-shell-docs-typecheck-20261006.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (`--maxWorkers=1 --execArgv=--max-old-space-size=4096`): **25/25** (`lgts-qual-guard-bindings-20261006.log`).
- `current-v2-authored-guides` + `llm-text` + `langgraph-typescript-doc-regions` (same flags): **3 files, 86/86** (`lgts-qual-docs-tests-20261006.log`). The doc-regions test also checks that `server.mjs` registers every `showcaseGraph` that `langgraph.json` does.
- Generation changed no tracked file.

## Commits

| SHA          | Subject                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `b02bf16e9c` | chore(showcase): update LangGraph TypeScript to CopilotKit 1.77.0 and AG-UI 1.0.1              |
| `dfdd312f50` | fix(showcase): verify the LangGraph TypeScript persistence preload against langgraph-api 1.5.2 |
| `bb1ae7bfdc` | fix(showcase): forward request headers from the LangGraph TypeScript declarative A2UI agent    |
| `7256775c4c` | docs(langgraph): make the TypeScript existing-agent steps reachable                            |

This record, its scripts and its logs are committed after them. **Shared sources:** `quickstart.mdx` is the page LangGraph Python shares. Its Python steps are unchanged apart from the outer switcher's removal. No probe, fixture, driver or `showcase/shared` file changed.

## Upstream findings (not filed; drafts for a human)

1. **`@copilotkit/runtime` 1.77.0 pulls two AG-UI versions.**
   - It pins `@ag-ui/core`/`client` 1.0.1 but depends on `@copilotkit/channels-core` `^0.11.0` and `channels-intelligence` `0.11.0`. Every 0.11.x pins `@ag-ui/core`/`client` **0.0.59** exactly.
   - A plain install therefore gets both versions: 15 × 0.0.59 and 7 × 1.0.1 in the quickstart's tree.
   - Repro: `npm init -y && npm install @copilotkit/runtime@1.77.0 && npm ls @ag-ui/core`.
   - Suggested fix: release `channels-*` pinned to 1.0.1, or make the AG-UI dependency a peer.
2. **AIMock 1.37.4 does not treat `developer` as `system` on `/v1/chat/completions`.** This is unchanged from 09-23. Repro: check 2b in `lgts-langchain-openai-checks-20261006.log`.
3. **`@langchain/openai` 1.6.2 still types a role-less first Chat Completions delta as `ChatMessageChunk`.** The 09-23 langchainjs draft still applies (check 1).

## Remaining defects and notes

1. **`validate-pins` is red** at 47 FAILs against a baseline of 26 (the canonical pin is still 1.68.2). It is unchanged in count; the hash changes.
2. **Inner A2UI sub-agent calls carry no headers.** The config-less `render_a2ui` call that `generate_a2ui` makes inside `gen-ui-declarative` carries no `x-*` headers. It matches context-free shared fixtures, which is how ADK, LGP and Mastra's fixtures are written. A stateful (`sequenceIndex`) fixture there would need the ALS fetch forwarding that `recovery-agent.ts` uses.
3. **`reproduce-lgp-byoc-setup.sh` / `extract-lgp-quickstart-python.py` need a check.** The extractor takes the region from the first Python tab to the next TypeScript tab. Since `5895f8030c` that region is only the `uv init` block, and this commit does not change that. Rerun the LGP script before relying on it.
4. **Not exercised:** `declarative-json-render` (routed only), `gen-ui-interrupt` and `interrupt-headless` (policy-excluded).

## Resources

- **Load.** Every heavy step ran under `nice -n 10`, one stack at a time. The 1-minute load was checked before each batch. The maximum sampled was **14.65**, below 16; no wait was needed.
- **RSS** was sampled every 2 s over the descendants of AIMock, each stack boot, each runner (with Playwright's Chromium) and the capture proxy (`lgts-rss-20261006.log`, `lgts-rss-sampler-20261006.sh`). The abort line was 10.5 GB.

  | Phase                       | Peak (sum of RSS)             | Largest process       |
  | --------------------------- | ----------------------------- | --------------------- |
  | Aborted single-boot batch A | **10,273,824 KiB = 10.52 GB** | `next-server` 6.66 GB |
  | First run A1…B3             | 8,966,128 KiB = 9.18 GB (A2)  | `next-server` 5.15 GB |
  | Red/green and neighbours    | 9,292,496 KiB = 9.52 GB       | `next-server` 4.20 GB |
  | Final run A1…B3             | 9,704,400 KiB = 9.94 GB (A2)  | `next-server` 5.91 GB |

  The figure sums RSS, so shared Chromium pages are counted more than once.

## Limitations

- **AIMock replay is not a live provider.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures. It does not prove model quality or real OpenAI behaviour.
  - The real-OpenAI claims (role on the first delta; no Chat Completions reasoning) rest on the API contract, not on a live capture.
  - `voice` covers the bundled transcript handoff, and `multimodal` the sample button.
- **Host-native, not Docker.** Everything ran on Node 22.16.0 on the host.
  - The Dockerfile's `npm ci --legacy-peer-deps` was validated as dry runs only.
  - The production agent path (`npm start` with the preload) was booted directly, but not inside the image or under `entrypoint.sh`'s watchdog.
- **MCP Apps needs a live external server.** `mcp-apps` and Beautiful Chat's Excalidraw tools discover `create_view` from `https://mcp.excalidraw.com/mcp` even under strict replay, so those cells are not hermetic.
- **The matrix is five runner processes on five boots,** forced by the RSS cap. Per-batch behaviour is otherwise the 09-23 method.
- **The setup reproduction does not cover the frontend.** It proves the agent, the route and one text run through the guide's route file. The Next.js scaffold, the React files, the Intelligence path and the pnpm/yarn/bun tabs were not reproduced.

## Cleanup

- Every stack boot (the `npm run dev` process group), AIMock, the setup script's agents and its scratch AIMock were stopped with SIGTERM to their own process groups; the capture proxy (a single process) with SIGTERM to its PID. The one leaked scratch AIMock (:4411) was stopped by hand. The sampler was stopped, and every runner exited.
- Ports 3101, 4410, 4411, 4412, 8123, 8124 and 2024 are free. Port 3000 was never touched.
- No `langgraph-cli`, `llmock`, `run-local-d6`, capture-proxy or runner-owned Chromium process remains.
- The `/private/tmp/lgts-byoc-setup.*` and `lgts-zod.*` directories are removed.
- **Left in place:** the ignored `.next/` and `src/agent/.langgraph_api/`, and the regenerated `node_modules/` in both LGTS packages.
