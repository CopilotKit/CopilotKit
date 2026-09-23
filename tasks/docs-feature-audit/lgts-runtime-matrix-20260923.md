# LangGraph TypeScript: local runtime qualification on published CopilotKit 1.73.3 (2026-09-23)

**Verdict: not qualified.** The raw strict matrix passed 39 of 40 checks. The published-catalog count is also 39 of 40, because every executed check corresponds to a shipped demo.

- **`mcp-apps` fails deterministically** (the rerun gave the same result). The failure is a real regression that the dependency update surfaced.
- **The documented complete-sample setup does not boot** with a fresh copy. This defect predates the update.

Both failures, their causes and proposed fixes are listed under [Defects](#defects-reported-not-fixed). The two quarantined LangGraph interrupt demos are **policy-excluded and untested**. They are not counted as passes.

All CopilotKit packages are the **unpatched, registry-published 1.73.3 artifacts**, with lock integrity matching `npm view` (`lgts-copilotkit-provenance-20260923.log`). No local core overlay or patch is used. Published 1.73.3 already contains the relative runtime-URL behaviour that REPAIR-011 needed (`new URL(runtimeUrl, window.location.href)` in `@copilotkit/core` `single-route-resource-request`).

## Provenance

- Worktree `tyler/docs-feature-audit`, HEAD `7ebd428fae`. At the start of the run, the LGTS diff from other agents consisted of comment-only `@region` markers plus one comment rewording (`manifest.yaml` and eight `src/` files). No behavioural change was present.
- Toolchains:
  - Locks generated and `npm ci` run with Node v24.11.0 / npm 11.6.1.
  - Locks re-validated with Node v22.16.0 / npm 10.9.2, which is the Dockerfile's major version (`lgts-lock-validate-npm10-20260923.log`).
  - Stack, matrix and setup reproduction ran on Node v22.16.0, matching the repo `.nvmrc` and the prior audit.
- Every heavy step ran under `nice -n 10`. Load and memory were checked before each step. One network-bound lock-only regeneration ran while the 1-minute load was 16.6; every later heavy step started with load under 14. System free memory stayed at 85–86% at every check.

## 1. Dependencies

Edited only `package.json`, `package-lock.json`, `src/agent/package.json` and `src/agent/package-lock.json`.

Manifest changes:

- **UI and agent:**
  - All `@copilotkit/*` packages set to `1.73.3`.
  - `@langchain/core` `1.2.12` and `@langchain/langgraph` `1.4.17`.
  - `langchain` `1.5.12`. This goes beyond the survey: re-verification found 1.5.12 was published 44 hours earlier, and its peer is `@langchain/core ^1.2.12`.
  - `dev` scripts now call `@langchain/langgraph-cli@1.5.0`.
- **UI only:**
  - `next` `^15.5.26` (latest 15.x).
  - `react` / `react-dom` `^19.3.0`.
  - The `@copilotkit/web-inspector → @copilotkit/core 1.68.2` override is **removed**.
- **Agent only:**
  - `@langchain/langgraph-api` / `-cli` `1.5.0`.
  - `@langchain/langgraph-sdk` `1.11.2`, an exact pin that satisfies LangGraph's `~1.11.2`.
  - `@langchain/langgraph-checkpoint` `1.1.5` and `@langchain/openai` `1.5.13`.
- **New overrides:** `@ag-ui/core` and `@ag-ui/client` → `0.0.59` in both packages. The agent keeps `@ag-ui/langgraph` → `0.0.42`.

  Without these overrides, a fresh resolution hoists `@ag-ui/core@1.0.0` through open peer ranges. In the agent it also hoists `@ag-ui/client@1.0.0`, beside nested 0.0.59 copies (Defect 3). These overrides must move whenever CopilotKit changes its exact AG-UI pin.

### How the locks were produced (`lgts-*-lock-update-20260923.log`)

1. **The 24-hour floor is not enforced by npm.** npm 11.6.1 reports `minimum-release-age` as an _unknown project config_ and ignores it. The first resolution pulled `electron-to-chromium@1.5.438` (10 hours old) and `node-releases@2.0.57` (11.6 hours old).

   All later resolutions used `--before=2026-09-22T21:49:00Z`. That is just after the last first-party 1.73.3 publish (`@copilotkit/web-inspector`, 21:48:01Z). Every added or changed entry was then audited individually with `npm view <pkg> time` (`lgts-lock-age-audit-20260923.json`):
   - **No violations.** The youngest non-exempt entries are `@typescript/vfs@1.6.5` (24.3 hours) and `openai@7.22.0` (25.6 hours).
   - **Only exempt packages are under 24 hours:** the first-party `@copilotkit/*@1.73.3` set, at about 22.3 hours, which the `.npmrc` exempts.
   - **All 930 UI and 297 agent entries resolve from `registry.npmjs.org`.** There are no `link:`, `file:` or other exotic sources.

2. **`npm ci` rejected the first lock** with `Missing: @emnapi/wasi-threads@1.2.3`. Every lock-only mutation of an existing lock (`install` and `dedupe`, with or without `node_modules`) drops the bundled `@emnapi/core` and `@emnapi/runtime` entries of `@tailwindcss/oxide-wasm32-wasi`. This is an npm 11.6.1 bug: lock-only mode does not load bundles.

   A fresh lock-only resolution records the entries correctly. The final locks were therefore generated from scratch with `rm -rf node_modules package-lock.json && npm install --package-lock-only --before=…`, using the overrides above. A stale `node_modules` also biased resolution and omitted `resolved`/`integrity` fields, which is why it was removed first.

3. **Clean installs:** `npm ci` added 297 agent packages and 930 UI packages, both with exit 0 (`lgts-agent-npm-ci-20260923.log`, `lgts-ui-npm-ci-20260923.log`). With npm 10.9.2, both packages also validate via `npm ci --dry-run`, with and without `--legacy-peer-deps`.

### Resolved versions after `npm ci` (`lgts-dependency-tree-20260923.log`)

| Package                                                                                                                                     | Before (committed lock)                       | After                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `@copilotkit/react-core`, `runtime`, `react-ui`, `sdk-js`, `a2ui-renderer`, `voice`, `web-inspector`, `web-components`, `mcp-apps-renderer` | 1.71.1                                        | **1.73.3**                                                |
| `@copilotkit/core` / `shared` (UI)                                                                                                          | 1.71.1 **+ stale 1.68.2** under web-inspector | **1.73.3 (single copy)**                                  |
| `@copilotkit/channels-*`                                                                                                                    | 0.9.2                                         | 0.11.0                                                    |
| `@ag-ui/core` / `client` / `encoder` / `proto`                                                                                              | 0.0.59 + 0.0.57 (UI)                          | **0.0.59 (single copy)** in both packages                 |
| `@ag-ui/langgraph`                                                                                                                          | UI 0.0.42 + 0.0.43; agent 0.0.42              | UI 0.0.43 (runtime) + 0.0.42 (under sdk-js); agent 0.0.42 |
| `@ag-ui/mcp-apps-middleware`                                                                                                                | 0.0.3                                         | **0.1.1** (Defect 1)                                      |
| `@langchain/core`                                                                                                                           | 1.2.11                                        | **1.2.12 (single copy)** in both packages                 |
| `@langchain/langgraph`                                                                                                                      | 1.4.15                                        | 1.4.17                                                    |
| `@langchain/langgraph-sdk`                                                                                                                  | UI 1.11.0; agent 1.11.0 + 1.9.15              | **1.11.2 (single copy)**                                  |
| `@langchain/langgraph-api` / `-cli` / `-ui` (agent)                                                                                         | 1.4.6                                         | 1.5.0                                                     |
| `@langchain/langgraph-checkpoint` / `@langchain/openai`                                                                                     | 1.1.5 / 1.5.13                                | 1.1.5 / 1.5.13                                            |
| `langchain`                                                                                                                                 | 1.5.11                                        | 1.5.12                                                    |
| `next` / `react` / `react-dom`                                                                                                              | 15.5.19 / 19.2.7                              | **15.5.26 / 19.3.0**                                      |
| `openai`                                                                                                                                    | UI 5.23.2; LangChain's copy 7.15.0            | 5.23.2; 7.22.0                                            |
| `@modelcontextprotocol/sdk`                                                                                                                 | 1.29.0                                        | 1.30.0                                                    |
| `typescript` / `tsx` (agent) / `zod`                                                                                                        | 5.9.3 / 4.21.0 / 3.25.76                      | 5.9.3 / 4.23.15 / 3.25.76                                 |

`npm ls @copilotkit/core @langchain/core` shows exactly one copy of each in both packages.

## 2. Static checks

| Check                                                                       | Command                                                                                                                                          | Result                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph strict typecheck (same as the checkpoint and the reproduction script) | `src/agent: tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck graph.ts`                         | **Pass**, exit 0, no diagnostics. Covers 1192 files, including `openai-headers.ts` and `shared-tools/*` (`lgts-graph-strict-tsc-20260923.log`).                                                                                                                                                     |
| UI build as run by Showcase CI                                              | CI builds only through the Dockerfile (`npm ci --legacy-peer-deps; npx next build`). Host equivalent: `NEXT_TELEMETRY_DISABLED=1 npx next build` | **Pass**, exit 0. Next 15.5.26, 57 static pages, 31 s, peak RSS 2.5 GB. Warnings are the existing hashbrown `Critical dependency` and workspace-root inference (`lgts-ui-next-build-20260923.log`). The build skips type errors because `next.config.ts` sets `typescript.ignoreBuildErrors: true`. |
| Informational: all 27 registered graph modules, same strict flags           | see log                                                                                                                                          | 9 errors (`lgts-all-graphs-strict-tsc-20260923.log`). The pre-update lock reports the same 9 locations, so **none comes from this update**. A tenth pre-update error, the missing `pdf-parse` module, is an environment artifact of the scratch copy (Defect 2).                                    |
| Informational: UI `tsc --noEmit -p tsconfig.json`                           | see log                                                                                                                                          | 22 errors, all pre-existing (`lgts-ui-tsc-20260923.log`). Examples: `ToolMessage` is not exported by `@copilotkit/shared` 1.71.1 or 1.73.3; `@types/react-dom` is missing; unused shadcn dependencies; ES2017 target limits.                                                                        |

## 3. Boot (default dev command, local AIMock)

- **Stale listeners:** none on 3101, 4410, 8123, 8124 or 2024 before starting. The only listener in range was the user's app on :3000, which was not touched.
- **AIMock:** `@copilotkit/aimock` 1.37.4, strict fixture-only mode (`lgts-aimock-20260923.log`). It loaded 8632 fixtures. No `--record`, `--proxy-only` or `--provider-*` flags were passed, so no request could leave the mock.

  ```sh
  AIMOCK_STRICT_TURN_INDEX=1 showcase/scripts/node_modules/.bin/llmock --port 4410 --host 127.0.0.1 --strict --validate-on-load --chunk-size 8 --latency 60 --fixtures showcase/aimock/{shared,d4,d5-recorded,d6}
  ```

- **Stack:** the integration's documented default dev command `npm run dev`, run as below. It starts `concurrently "next dev --turbopack"` together with `langgraph-cli@1.5.0 dev --port 8123` (`lgts-dev-stack-20260923.log`).

  ```sh
  PORT=3101 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 LANGSMITH_TRACING=false OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4410/v1 AIMOCK_URL=http://127.0.0.1:4410 LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123 npm run dev
  ```

- **Result: booted on the first attempt, with Turbopack; no Webpack fallback was needed.**
  - The UI bound `*:3101` and `/api/health` returned 200.
  - The agent registered **all 28 `langgraph.json` graphs**, started 10 workers, bound `[::1]:8123` (the IPv6-only `localhost` the guide describes), and `/ok` returned 200. Both were healthy about 6 s after start.
  - The single-route `POST /api/copilotkit` `info` request returned 200. `GET …/info` returns 404, which is expected in single-route mode.
- **Route pre-warm:** before the matrix, all 39 demo routes and 16 API routes were requested one at a time. All 39 pages returned 200 (`lgts-prewarm-20260923.log`). This avoids parallel Turbopack cold compiles and does not change any test.

## 4. Full strict D6 matrix

The runner and AIMock mode are the same ones the Built-in Agent final strict-turn matrix used (`repair021-built-in-agent-full-d6-strict-turn-final.log`). The audit records show that run used the host-native wrapper `run-local-d6.mts`, not `bin/showcase test … --d6`, and this run does the same.

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-typescript
```

This is one runner process. Feature concurrency is the shared driver's hard-coded `FEATURE_CONCURRENCY_D6 = 4`, which has no configuration knob, so it is the lowest setting the full-matrix mode allows.

**Counts:**

|                   | Checks | Pass | Fail | Skipped |
| ----------------- | ------ | ---- | ---- | ------- |
| Raw matrix        | 40     | 39   | 1    | 0       |
| Published catalog | 40     | 39   | 1    | 0       |

- The published count equals the raw count because all 40 execution units correspond to routed, non-quarantined demos.
- Duration: 165.6 s in the driver (20:20:54–20:23:40Z) and 165.9 s wall.
- Log: `lgts-d6-full-20260923.log`. Machine-readable results: `lgts-runtime-matrix-20260923.json`.

**How the 40 units relate to the 39 routed demos:**

- The two interrupt demos are excluded, leaving 37 applicable routed demos.
- `beautiful-chat` expands into 5 checks.
- `declarative-hashbrown` and `declarative-json-render` fold into one `byoc` check. That check navigates only to `declarative-hashbrown`, so **`declarative-json-render` is routed but not directly exercised.**
- In demo terms, 36 demos were exercised: 35 green and 1 red.

**Policy-excluded, untested:** `gen-ui-interrupt` and `interrupt-headless`. `manifest.yaml` `not_supported_features` quarantines them "pending a @copilotkit/react-core release" because of a `useInterrupt` / `useHeadlessInterrupt` resume-path bug. They did not run, and it is unknown whether 1.73.3 fixes that bug; a targeted check is needed before lifting the quarantine.

### Failures and reruns

| Check      | Full run                                           | Assertion / cause                                                                                                                                               | Rerun (`--demo mcp-apps`, same stack)                                         | Classification                                |
| ---------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `mcp-apps` | **FAIL** after the harness's in-run retry (65.8 s) | `waitForTurnComplete: turn 1 did not complete within 30000ms (reason=dom-missing, runsFinished=0, count=0, attrPresent=true, runningNow=true, runStartCount=1)` | **FAIL**, identical assertion (66.0 s; `lgts-d6-rerun-mcp-apps-20260923.log`) | **Real, deterministic regression** (Defect 1) |

The chain of evidence for `mcp-apps`:

1. The runtime logs `MCP tool discovery failed { serverId: 'excalidraw' } [TypeError: fetch failed] { cause: unexpected redirect }` (17 times across the run).
2. As a result, the model request carries **zero tools**. All 26 strict-mode 503s in the AIMock journal are this one prompt with `tools=[]`. The fixture requires `toolName: create_view`.
3. The model client's automatic retries on 503 (seven requests per run) keep the run open past the 30 s turn timeout. That explains `runningNow=true` with no error banner.

Every other check passed on its first attempt.

Per-check durations in milliseconds (all passed unless noted):

| Checks                                                                                   | Duration (ms)                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------ |
| a2ui-recovery                                                                            | 9500                                 |
| agent-config                                                                             | 33212                                |
| agentic-chat                                                                             | 14962                                |
| auth                                                                                     | 54590                                |
| beautiful-chat: bar-chart / pie-chart / schedule-meeting / search-flights / toggle-theme | 12399 / 12602 / 5688 / 14050 / 10042 |
| byoc                                                                                     | 10363                                |
| chat-css                                                                                 | 5953                                 |
| chat-slots                                                                               | 6411                                 |
| frontend-tools / frontend-tools-async                                                    | 17526 / 9798                         |
| gen-ui-a2ui-fixed                                                                        | 8685                                 |
| gen-ui-agent                                                                             | 17950                                |
| gen-ui-custom                                                                            | 8136                                 |
| gen-ui-declarative                                                                       | 13674                                |
| gen-ui-headless-complete                                                                 | 25914                                |
| gen-ui-open / gen-ui-open-advanced                                                       | 18212 / 18256                        |
| headless-simple                                                                          | 12918                                |
| hitl-approve-deny / hitl-text-input                                                      | 10076 / 9398                         |
| **mcp-apps (FAIL)**                                                                      | **65781**                            |
| multimodal                                                                               | 10107                                |
| prebuilt-popup / prebuilt-sidebar                                                        | 8531 / 8559                          |
| readonly-state-context                                                                   | 8261                                 |
| reasoning-custom / reasoning-default                                                     | 6204 / 6534                          |
| shared-state-read / shared-state-streaming / shared-state-write                          | 11295 / 14835 / 10545                |
| subagents                                                                                | 31241                                |
| tool-rendering / custom-catchall / default-catchall / reasoning-chain                    | 6619 / 12594 / 8007 / 24512          |
| voice                                                                                    | 4542                                 |

## 5. Documented setup reproduction

| Script                                                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reproduce-lgts-byoc-setup.sh` (2026-09-13, unchanged because it is outside this run's edit scope)                                                                                                                                                                                                         | **Pass**, exit 0, 21 s. `npm ci --ignore-scripts` installed 251 packages from the new agent lock, and the strict `graph.ts` check reported no diagnostics (`lgts-byoc-setup-script-20260923.log`). The script never starts a server, so this is not boot evidence.              |
| `reproduce-lgts-byoc-setup-20260923.sh` (new). It copies only what a clone of the working tree contains (`git ls-files -co --exclude-standard`), then runs the guide's callout verbatim: `cp .env.example .env`, set `OPENAI_API_KEY`, `cd src/agent && npm ci && npm run dev`, then waits for `:8123/ok`. | **FAIL: does not boot.** `npm ci` succeeded with 1.73.3, 1.5.0 and 1.4.17 resolved. Graph registration then aborted with `Error: Cannot find module 'pdf-parse'`, required from `src/agent/multimodal.ts`, and nothing bound 8123 within 120 s (`lgts-byoc-boot-20260923.log`). |
| Diagnostic only, throwaway copy with no repo change: the same steps plus `npm install --no-save pdf-parse@1.1.4`                                                                                                                                                                                           | Boots in 3 s. All 28 assistants return `GET /assistants/<id>/graph` 200 (`lgts-byoc-boot-diagnostic-20260923.log`). **`pdf-parse` is the only boot blocker.**                                                                                                                   |

Changes needed in `reproduce-lgts-byoc-setup.sh`, reported rather than applied because the file is outside this run's scope:

- Its `tar` copy carries ignored local state that a clone would not have: `.env`, a 517 MB `.next/`, and 51 MB of persisted threads in `src/agent/.langgraph_api/`.
- It uses `npm ci --ignore-scripts` rather than the documented `npm ci`.
- It never runs `npm run dev`.

The 2026-09-23 variant addresses all three.

## Defects (reported, not fixed)

1. **MCP Apps default server URL redirects, and the hardened middleware in 1.73.3 rejects redirects.** This is a regression surfaced by the update and fails the `mcp-apps` check.
   - **Files:** `showcase/integrations/langgraph-typescript/src/app/api/copilotkit-mcp-apps/[[...slug]]/route.ts:57` and `src/app/api/copilotkit-beautiful-chat/route.ts:54`.
   - **Cause:** `@copilotkit/runtime@1.73.3` depends on `@ag-ui/mcp-apps-middleware ^0.1.1` (`packages/runtime/package.json:89`); 1.71.1 pinned 0.0.3, which follows redirects. Version 0.1.1 fetches with `redirect: "error"` and a same-origin guard. The default URL `https://mcp.excalidraw.com` returns **308 → `https://mcp.excalidraw.com/mcp`**, so tool discovery fails.
   - **Beautiful Chat also loses its Excalidraw tools silently.** Its D6 checks do not cover them.
   - **Proposed fix:** change the default to `https://mcp.excalidraw.com/mcp`, which returns 405 to GET with no redirect.
     - `serverId` is pinned, so thread restoration is unaffected.
     - The same bare-origin default appears in about 20 other integrations' MCP Apps and Beautiful Chat routes, and should change with them. Any integration that moves to runtime ≥1.73 will hit this.
     - The fixed URL was not rerun, because of the one-rerun budget.
   - The cell also depends on a live external MCP server even in strict local replay, so it is not hermetic.
2. **The documented complete-sample agent does not boot. This predates the update.**
   - **File:** `src/agent/multimodal.ts:36` has `import pdfParse from "pdf-parse"`, but `pdf-parse` is declared only in the UI `package.json`.
   - It works in the worktree and in Docker only because the UI `node_modules` is an ancestor directory.
   - **Proposed fix:** add `pdf-parse` 1.1.4 to `dependencies` and `@types/pdf-parse` to `devDependencies` in `src/agent/package.json`, then regenerate its lock. This is inside this run's file scope but was not applied, per the instructions.
3. **Unbounded AG-UI peer range in published `@copilotkit/shared@1.73.3`.**
   - **Where:** `packages/shared/package.json:98` declares `"@ag-ui/core": ">=0.0.48"`, while every other CopilotKit package pins 0.0.59.
   - **Effect:** now that `@ag-ui/core` / `client` 1.0.0 are published (2026-09-17), any fresh npm resolution without overrides mixes 1.0.0 with nested 0.0.59 copies.
   - **Worst case, in the agent:** the directly imported `@ag-ui/langgraph` (`graph.ts:22`, `recovery-agent.ts:55-56`) would run against core/client 1.0.0.
   - **Proposed fix:** bound the peer (for example `^0.0.59` or `>=0.0.48 <0.1.0`). `@ag-ui/langgraph`'s `>=0.0.42` peers are upstream in `ag-ui-protocol/ag-ui`. The overrides mitigate this locally.
4. **The LGTS smoke endpoint is a false positive. This predates the update; langgraph-api 1.4.6 and 1.5.0 both validate `thread_id` as a UUID.**
   - **File:** `src/app/api/smoke/route.ts:22` sends `threadId: smoke-${Date.now()}`.
   - **Effect:** the LangGraph API returns `POST /threads 400 Invalid uuid` and the run emits `RUN_ERROR`, but the route still returns `{"status":"ok"}` because it only checks for a non-empty body.
   - **Proposed fix:** use `crypto.randomUUID()` for `threadId` and `runId`, and treat a `RUN_ERROR` event as a failure.
5. **Minor findings:**
   - **First-party skew:** `@ag-ui/langgraph` is pinned to 0.0.43 in runtime (`packages/runtime/package.json:88`) but 0.0.42 in sdk-js (`packages/sdk-js/package.json:62`), which leaves two copies in the UI.
   - **Undeclared imports:** the agent imports `@ag-ui/langgraph` and the UI imports `@ag-ui/core` types without declaring either.
   - **Stale docs:** `shell-docs/.../langgraph/quickstart.mdx` still says `@copilotkit/sdk-js@1.71.0` in its Zod callout. 1.73.3 still requires Zod 3.
   - **Schema warning:** langgraph-api 1.5.0 logs `Option '--incremental' can only be specified using tsconfig…` 30 times during schema extraction. It is not fatal.

## Limitations

- **AIMock replay is not a live provider.** Checks prove fixture-matched protocol, rendering and state behaviour with strict matching and strict turn index. They do not prove model quality or real-provider request compatibility.
  - `voice` covers the bundled transcript handoff, not microphone capture or transcription.
  - `multimodal` covers the sample-button path.
- **Published versus local.** Everything on the CopilotKit side ran on unpatched published 1.73.3: the UI runtime and React packages, and the agent's `sdk-js` and `shared`. The only local code is the Showcase integration itself, with other agents' comment-only region edits.
- **Host-native, not Docker.** The build and boot ran on the host with Node 22, not in the Dockerfile image. The Docker-specific `npm ci --legacy-peer-deps` was only dry-run validated with npm 10.
- **External service.** The MCP Apps and Beautiful Chat MCP paths contact a live external MCP server.
- **Resources.** The stack reached 9.9 GB RSS after the matrix, with `next-server` (Turbopack) at 8.6 GB after compiling every route. The runner's Chromium was not sampled mid-run.

## Cleanup

- The matrix stack (13 processes, one session) and AIMock were stopped with SIGTERM to their process groups; all exited.
- The runner and reproduction dev servers ran in their own sessions and are gone.
- No `langgraph-cli`, `llmock`, `run-local-d6` or Playwright process remains.
- Ports 3101, 4410, 8123, 8124 and 2024 are free.
- The reproduction temp copies under `/private/tmp` were removed.
- The user's :3000 app was never touched.
- Remaining ignored local build and runtime state, left in place: `.next/`, `src/agent/.langgraph_api/` and `next-env.d.ts`.
