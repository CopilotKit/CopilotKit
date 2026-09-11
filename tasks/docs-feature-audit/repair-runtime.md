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
