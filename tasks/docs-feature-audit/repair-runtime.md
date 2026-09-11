# Runtime repair iterations

## ADK-013 — auth route collision

- Baseline: the Google ADK UI could not start because Next App Router had both `api/copilotkit-auth/route.ts` and an equally-specific `api/copilotkit-auth/[[...slug]]/route.ts`.
- Change: moved the existing auth runtime handler into the catch-all route and removed the conflicting sibling route. The catch-all owns the base runtime endpoint plus V2 subpaths; auth behavior, agent URL, header forwarding, and request hook are unchanged.
- Before/after runtime evidence: pending host start and strict D6 `auth` plus two additional cells.

### Fresh isolated RED

- Revision: `b0079629eae9445f82cae66baf674c091da971ad` in `/private/tmp/adk013-baseline`.
- Command: `PORT=3121 NEXT_TELEMETRY_DISABLED=1 npm --prefix /private/tmp/adk013-baseline/showcase/integrations/google-adk run dev`.
- Result: Next 15.5.19/Turbopack started then failed with `You cannot define a route with the same specificity as a optional catch-all route ("/api/copilotkit-auth" and "/api/copilotkit-auth[[...slug]]")`.
- Durable log: `/private/tmp/adk013-baseline-startup.log`; the isolated process was stopped after capture.

### Green, cell 1/3: auth

- Stack: repaired UI `http://127.0.0.1:3103`, agent `http://127.0.0.1:8001`, audit-owned strict local AIMock `http://127.0.0.1:4410` (8630 loaded fixtures).
- Command: `AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts google-adk --demo auth`.
- Result: `d6:google-adk/auth` green (one executed, zero failed) after the auth control revealed the chat input and the request completed through `POST /api/copilotkit-auth/agent/auth-demo/run` and backend `/auth`.
- Durable result: `tasks/docs-feature-audit/repair-adk-auth-d6.log`.

## ADK local AIMock context default — strict fixture repair

### Browser RED without harness headers

- An ordinary local browser flow signed in, sent the D6 fixture prompt `auth check turn 1`, and received `503 UNAVAILABLE: Strict mode: no fixture matched`. The D6 fixture is scoped to `context: google-adk`; the browser does not add the harness-only request header.
- The captured backend error excerpt is `tasks/docs-feature-audit/repair-adk-context-baseline-red.log`. This is independent of ADK-013: the repaired auth route returned 200 but omitted the fixture namespace on a human local request.

### Change and independent review

- `extractForwardedHeaders()` now provides the constant `google-adk` fixture context only when the server has `AIMOCK_URL` configured and no inbound context exists. An explicit incoming context remains authoritative.
- Independent review found that only an `x-*` fixture namespace value is added; Authorization, cookies, and content-type remain excluded, and an unset `AIMOCK_URL` preserves live-provider behavior.

### Browser GREEN without harness headers

- A fresh browser context with all non-local requests blocked signed in, sent the same fixture prompt, and rendered the expected confirmation. Screenshot: `tasks/docs-feature-audit/repair-adk-auth-manual-green.png`; runner result: `tasks/docs-feature-audit/repair-adk-auth-manual-context-proof.log`.

### D6 regression: 3/3 green

- `auth`: `tasks/docs-feature-audit/repair-adk-context-auth-d6.log` — 1 passed, 0 failed.
- `agentic-chat`: `tasks/docs-feature-audit/repair-adk-context-agentic-chat-d6.log` — 1 passed, 0 failed.
- `tool-rendering`: `tasks/docs-feature-audit/repair-adk-context-tool-rendering-d6.log` — 1 passed, 0 failed and rendered the weather-card assertion.

## LGTS-017 — default Turbopack CVDIAG module resolution

### Fresh RED

- Current-source default Turbopack UI compiled `/demos/agentic-chat`, but a request to `/api/copilotkit` returned 500. Turbopack could not resolve the CVDIAG's NodeNext-style relative `.js` module specifiers (`schema.js`, `emit.js`, and `pb-writer-fetch.js`).
- Command and durable log: `NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true LANGGRAPH_DEPLOYMENT_URL=http://127.0.0.1:8124 ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3101`; `/private/tmp/lgts017-baseline-turbopack.log`.

### Change

- Added five source-scoped ESM `.js` bridge modules next to the CVDIAG TypeScript modules. The existing canonical relative `.js` specifiers now resolve under both Turbopack and Webpack without a global alias that could affect dependency imports.
- Removed the obsolete Webpack-only extension-alias configuration.

### Green

- The same `/api/copilotkit` request compiled and returned 200 under direct Turbopack (`/private/tmp/lgts017-final-turbopack.log`) and under the checked-in `npm --prefix showcase/integrations/langgraph-typescript run dev` command (`/private/tmp/lgts017-default-dev.log`).
- Strict D6 3/3 green through the final Turbopack UI and local AIMock: `agentic-chat`, `tool-rendering`, and `frontend-tools` each executed one passing cell with zero failures. Logs: `tasks/docs-feature-audit/repair-lgts017-final-*-d6.log`.

## LGTS-017 — complete execution record

### Fresh RED

- Command: `cd showcase/integrations/langgraph-typescript && NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true LANGGRAPH_DEPLOYMENT_URL=http://127.0.0.1:8124 ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3101`.
- Result: the current source compiled `/demos/agentic-chat`, but `GET /api/copilotkit` returned 500 because Turbopack could not resolve the canonical CVDIAG relative `.js` specifiers. Durable log: `/private/tmp/lgts017-baseline-turbopack.log`.

### GREEN

- Direct Turbopack verification: the same route compiled and returned 200 after the source bridge fix; durable log: `/private/tmp/lgts017-final-turbopack.log`.
- Default-command verification: `PORT=3101 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true LANGGRAPH_DEPLOYMENT_URL=http://localhost:8124 OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4410/v1 AIMOCK_URL=http://127.0.0.1:4410 npm --prefix showcase/integrations/langgraph-typescript run dev`; the default Turbopack command compiled and served `/api/copilotkit` with HTTP 200. Durable log: `/private/tmp/lgts017-default-dev.log`.
- Strict local-AIMock D6 regression, all green: `agentic-chat`, `tool-rendering`, and `frontend-tools`, each one executed / zero failed. Commands used `AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-typescript --demo <id>`. Logs: `tasks/docs-feature-audit/repair-lgts017-final-agentic-chat-d6.log`, `tasks/docs-feature-audit/repair-lgts017-final-tool-rendering-d6.log`, `tasks/docs-feature-audit/repair-lgts017-final-frontend-tools-d6.log`.
- Independent review: source-scoped ESM bridges preserve canonical CVDIAG imports and remove the bundler-specific alias, with no auth or secret impact.

## BIA-007 — Agent Config controls routed to the factory input

### Fresh local RED

- Current unmodified demo at `http://127.0.0.1:3117/demos/agent-config`; a browser capture selected `enthusiastic` / `expert` / `detailed` then sent a neutral sentinel. The outgoing `agent/run` payload contained the values only in `context`, with `forwardedProps: {}`. Durable capture: `tasks/docs-feature-audit/repair-bia007-current-red.json`.
- The in-process factory reads only `input.forwardedProps`, so it used defaults. The existing `agent-config` fixture selects canned answers by user-message text and integration context and therefore could not expose this routing fault.

### Change and GREEN

- The page now passes its typed config as the provider `properties` value, the contract declared by the Built-in Agent manifest. The obsolete context relay was removed.
- The identical browser capture now has the selected `tone`, `expertise`, and `responseLength` in `forwardedProps` and no context entry: `tasks/docs-feature-audit/repair-bia007-green-request.json`.
- Strict local-AIMock D6 regression: `agent-config` green with six completed control turns; `agentic-chat` green with three turns; `tool-rendering` green with its weather-card assertion. Logs: `tasks/docs-feature-audit/repair-bia007-agent-config-d6.log`, `tasks/docs-feature-audit/repair-bia007-agentic-chat-d6.log`, `tasks/docs-feature-audit/repair-bia007-tool-rendering-d6.log`.

## Strands C008 — backend recipe state lifting

- Fresh direct builder RED showed the recipe sentinel absent from the outgoing model prompt while existing preference state was present. The backend had no `state.recipe` branch.
- The state-context builder now formats the recipe snapshot on every turn. Direct sentinel GREEN: `tasks/docs-feature-audit/repair-strands008-recipe-builder-green.txt` contains both the title and ingredient sentinels.
- The Strands fixture now requires the emitted `Current recipe from the editor` marker. The pre-readiness strict D6 RED is retained in `tasks/docs-feature-audit/repair-strands008-recipe-prompt-gated-d6.log` (AIMock 503 no fixture match). After the repair it is green in `tasks/docs-feature-audit/repair-strands008-recipe-prompt-gated-green3-d6.log`.

## REPAIR-006 — shared recipe initialization readiness race

- Separate from C008: the shared React page seeded a provisional `useAgent` object in an empty-dependency effect. Runtime synchronization then replaced that object, so the first real request could omit recipe state.
- The canonical page waits for `isReady`, seeds the synchronized agent, and exposes the sidebar/send path only after initialization. It is materialized identically into Strands, LangGraph Python, and LangGraph TypeScript by `showcase/scripts/sync-shared-frontends.ts`; CI runs the checker from `showcase_validate.yml`.
- Focused fanout test: one worker / no file parallelism, `tasks/docs-feature-audit/repair-shared-frontend-fanout-test.log` — 1 passing test.
- Fresh strict D6 GREEN (one stack at a time): Strands `repair-shared-frontend-strands-shared-state-read-d6.log` (7.3s), LangGraph Python `repair-shared-frontend-langgraph-python-shared-state-read-d6.log` (8.9s), LangGraph TypeScript `repair-shared-frontend-langgraph-typescript-shared-state-read-d6.log` (12.4s). Each ran two shared-probe turns with one pass and zero failures.
- The first LangGraph TypeScript retry was invalid setup only: local `AGENT_URL` was ignored and the runtime retained its default `localhost:8123`; the corrected `LANGGRAPH_DEPLOYMENT_URL=http://localhost:8124` green result above is authoritative. Audit stacks were stopped after every cell; final listener check found no audit ports or probe workers, and only pre-existing cpki containers remained.

## LangGraph Python — scoped latest stable dependency compatibility

- PyPI metadata was read on 2026-09-10. The audited latest set is `copilotkit 0.1.96`, `ag-ui-protocol 0.1.22`, `ag-ui-langgraph 0.0.45`, `langchain 1.4.0`, `langgraph 1.2.11`, `langgraph-cli[inmem] 0.4.31`, `langgraph-api 0.14.0`, `langsmith 0.12.4`, and `deepagents 0.7.13`. `deepagents 0.7.13` requires `langsmith >=0.11.2` and `langchain-anthropic >=1.7.0`, so `langchain-anthropic` is upgraded to `1.7.2`. Existing `langchain-openai 1.1.9` and `openai 1.109.1` resolve unchanged and were intentionally left outside this compatibility-driven update.
- Resolver evidence: the first proposed `langchain 1.5.11` target was rejected because that release does not exist on PyPI; `stable-langgraph-python-uv-pypi-dry-run.log` records the correction. `stable-langgraph-python-core-only-dry-run.log` and `stable-langgraph-python-core-compatible-dry-run.log` record the two direct dependency conflicts above. The final minimal compatible resolver is green in `stable-langgraph-python-core-compatible2-dry-run.log`.
- Isolated environment install: `/private/tmp/copilotkit-host-native-python/langgraph-python`; durable log `/private/tmp/langgraph-python-stable-install.log`. All upgraded framework and adapter imports succeeded.
- Local stack: latest agent `127.0.0.1:8123`, Showcase UI `127.0.0.1:3100`, strict isolated AIMock `127.0.0.1:4410`, fake provider variables only. The agent booted and loaded the full graph catalog under `langgraph-api 0.14.0`.
- Strict D6 green: `agentic-chat` (3 turns, `stable-langgraph-python-agentic-chat-d6.log`), `tool-rendering` (weather-card assertion, `stable-langgraph-python-tool-rendering-d6.log`), and `shared-state-read` (2 turns, `stable-langgraph-python-shared-state-read-d6.log`). Each executed one cell with zero failures.
- Scope limit: this establishes three representative current-source cells after the Python dependency change. It does not qualify LangGraph Python's full routed-feature matrix, media paths, guide rendering, or the still-old JavaScript frontend CopilotKit packages; those remain separate gates.

## REPAIR-011 — latest published core rejects relative runtime URLs

### Fresh RED on published 1.71.0

- Built-in Agent was upgraded to published CopilotKit `1.71.0` packages and normally installed from its regenerated lockfile. Its local UI started at `http://127.0.0.1:3117`; strict AIMock was `http://127.0.0.1:4410` with fake provider variables only.
- The existing browser provider URL is relative (`/api/copilotkit`). The runtime sent `GET /api/copilotkit/info` (404) and `POST /api/copilotkit` (200), then the browser raised `Failed to construct 'URL': Invalid URL` before the agent or AIMock ran. Strict `agentic-chat` reproduced the failure twice and had zero AIMock journal entries: `tasks/docs-feature-audit/stable-built-in-agent-agentic-chat-d6.log`.
- Separate local iframe/browser evidence selected `professional` / `intermediate` / `concise`, sent literal `tone:professional`, and showed the same error without an assistant response. This is current published-SDK evidence, not a fixture mismatch.

### Shared owning source and scope

- `packages/core/src/utils/single-route-resource-request.ts` constructed `new URL(runtimeUrl)` without a browser base, while 206 selected-five frontend providers pass relative `/api/...` runtime URLs. The shared core source now resolves those paths against the browser location and keeps absolute server runtime URLs valid; its focused regression tests cover relative browser and absolute server inputs.
- This needs a new CopilotKit package release before the selected demos can claim latest _published_ SDK qualification. The local build/relink and D6 green proof are tracked separately from the published-1.71.0 RED.
