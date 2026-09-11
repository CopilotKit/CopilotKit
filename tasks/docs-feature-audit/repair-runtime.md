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
