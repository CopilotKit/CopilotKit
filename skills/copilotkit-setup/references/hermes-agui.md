# Reuse an Existing Hermes Agent Through AG-UI

Use this path only after:

1. `command -v hermes` finds an existing installation.
2. The user explicitly chooses to reuse it.
3. `hermes agui --check` succeeds.

If the capability check fails, stop this path. Tell the user their Hermes build is incompatible or is missing AG-UI dependencies. Do not install, update, configure, or otherwise mutate Hermes; the user can manage their Hermes installation themselves or return to the normal `BuiltInAgent` setup.

## Ownership boundary

Hermes remains the agent. Its existing configuration owns the model, provider credentials, prompt, tools, approvals, and execution environment. CopilotKit provides the frontend and a server-side runtime that proxies AG-UI events to and from Hermes.

Do not create a `BuiltInAgent`, select another model, copy provider credentials into the CopilotKit app, run `hermes setup agui`, or edit Hermes configuration.

## Install the CopilotKit-side packages

Use the project's package manager to install these packages:

```bash
npm install @copilotkit/react-core @copilotkit/runtime @ag-ui/client hono
```

Use the generic `HttpAgent` from `@ag-ui/client`. Do **not** install or import `@ag-ui/hermes`; the Hermes server already speaks the AG-UI protocol and needs no framework-specific client.

## Start and check the existing server

Start Hermes in a separate terminal:

```bash
hermes agui
```

The default local server binds to `127.0.0.1:8000`. Check readiness:

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/health
```

`GET /health` is only the readiness endpoint. The AG-UI run endpoint is `POST /`, so set the server-only agent URL to the root endpoint, including the trailing slash:

```dotenv
AGENT_URL=http://127.0.0.1:8000/
```

Do not expose `AGENT_URL` with a `NEXT_PUBLIC_` or `VITE_` prefix.

## Wire Hermes into the CopilotKit runtime

Before writing the runtime, ask the same managed Intelligence versus self-hosted SSE question described in Step 2 of the main skill, defaulting to managed Intelligence. Use the existing Hermes `HttpAgent` in either mode.

For a Next.js App Router project, create or update `src/app/api/copilotkit/[[...slug]]/route.ts`:

```typescript
import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const sessionToken = process.env.HERMES_AGUI_SESSION_TOKEN;

const hermes = new HttpAgent({
  url: process.env.AGENT_URL ?? "http://127.0.0.1:8000/",
  ...(sessionToken
    ? {
        headers: {
          "X-Hermes-Session-Token": sessionToken,
        },
      }
    : {}),
});

const runtime = new CopilotRuntime({
  agents: {
    default: hermes,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```

Keep the runtime server-side: the browser should call `/api/copilotkit`, and only that runtime should call `AGENT_URL`.

The main skill's runtime-mode choice still applies. The example above is self-hosted SSE. For managed Intelligence, keep the same `HttpAgent` in `agents`, remove `runner`, add `intelligence: new CopilotKitIntelligence(...)`, and add the required authenticated `identifyUser` exactly as shown in Step 2. Then complete Step 6.

Do not generate or pass a `threadId` in a query parameter, header, URL, or custom request body. CopilotKit and `HttpAgent` already carry the runtime's thread ID in AG-UI `RunAgentInput`.

After the runtime is wired, resume the main setup workflow at Step 3 to add the frontend provider and chat UI. Skip Step 5's `BuiltInAgent` provider-key instructions; `AGENT_URL` and, only when already required by Hermes, `HERMES_AGUI_SESSION_TOKEN` are this path's server-side environment variables.

## Security

- **Local loopback:** The default `127.0.0.1` server needs no token. Keep the server-to-server hop on loopback and do not invent a token.
- **Existing token on loopback:** If the user's Hermes process already requires `HERMES_AGUI_SESSION_TOKEN`, make the same secret available only to the CopilotKit runtime. The code above sends it in the `X-Hermes-Session-Token` header.
- **Network bind:** A non-loopback Hermes server must already be configured with a valid `HERMES_AGUI_SESSION_TOKEN`. If the token is unavailable, stop; do not weaken or change Hermes security settings. Keep the secret server-side and use the header, never a `?token=` query parameter.
- **Agent authority:** Hermes tools may execute terminal commands or modify files with the authority of its configured environment. Preserve its existing approval and tool policies, and do not expose the agent endpoint directly to the browser.

## Verify

1. Confirm `hermes agui --check` succeeds.
2. Start `hermes agui` and confirm `GET /health` succeeds.
3. Start the CopilotKit app and confirm its runtime info endpoint lists `default`.
4. Send a chat message and confirm the streamed response comes from the existing Hermes agent.

If `/health` works but chat does not, confirm `AGENT_URL` points to the root `/` endpoint rather than `/health`, and confirm any required session token reaches the server-side `HttpAgent`.
