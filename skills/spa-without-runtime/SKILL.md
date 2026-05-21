---
name: spa-without-runtime
description: >
  Build a pure-client CopilotKit v2 SPA with NO server runtime by pointing
  CopilotKitProvider at CopilotKit Cloud via publicApiKey. This is the
  ONLY production-safe SPA path. Both agents__unsafe_dev_only and
  selfManagedAgents are dev-only aliases that leak credentials in production
  — never ship them. Covers Vite / plain React Router SPA wiring, getting a
  publicApiKey from cloud.copilotkit.ai, and the SSR non-concern.
  publicLicenseKey is an accepted alias for publicApiKey (publicApiKey wins
  when both are set). Load when the user has no backend and wants chat in a
  pure-SPA deployment (Vite, GitHub Pages, S3, etc.).
type: lifecycle
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/react-core
  - copilotkit/0-to-working-chat
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/providers/CopilotKitProvider.tsx"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/common-issues.mdx"
  - "CopilotKit/CopilotKit:packages/core/src/core/core.ts"
---

## Setup

Obtain a `publicApiKey` from cloud.copilotkit.ai. In a Vite SPA:

```bash
# .env.local
VITE_CPK_PUBLIC_API_KEY=ck_pub_xxxxxxxxxxxxxxxxxxxx
```

```tsx
// src/App.tsx
import {
  CopilotKitProvider,
  CopilotChat,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { z } from "zod";

function RegisterTools() {
  useFrontendTool({
    name: "readClipboard",
    description: "Read the clipboard contents.",
    parameters: z.object({}),
    handler: async () => {
      try {
        const text = await navigator.clipboard.readText();
        return { text };
      } catch (error) {
        // navigator.clipboard.readText() rejects on denied permission,
        // non-HTTPS origins, and lost document focus. Return a structured
        // error so the agent sees it as a regular tool result and can
        // respond ("I couldn't read your clipboard — please paste here")
        // instead of surfacing a raw DOMException.
        //
        // Note: returning an error object does NOT trigger `onError` with
        // `tool_handler_failed` — that fires only when the handler throws.
        // If you want `onError` to fire, `throw` instead of returning.
        return {
          error: "clipboard_read_failed",
          message:
            error instanceof Error ? error.message : "Clipboard unavailable",
        };
      }
    },
  });
  return null;
}

export default function App() {
  return (
    <CopilotKitProvider publicApiKey={import.meta.env.VITE_CPK_PUBLIC_API_KEY}>
      <RegisterTools />
      <div className="h-screen">
        <CopilotChat agentId="default" className="h-full" />
      </div>
    </CopilotKitProvider>
  );
}
```

No `runtimeUrl`. No server. Auth header
(`X-CopilotCloud-Public-Api-Key: ck_pub_...`) is injected by the Cloud
client. Frontend tools still work — they execute in the browser; the Cloud
runtime dispatches tool calls to the SPA over SSE.

## Core Patterns

### Registering frontend tools in a pure SPA

Frontend tools work identically to the full-runtime case — register them
inside the provider subtree.

```tsx
import { useFrontendTool, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";

function AppTools() {
  useFrontendTool({
    name: "navigate",
    description: "Navigate to a route",
    parameters: z.object({ path: z.string() }),
    handler: async ({ path }) => {
      // Use your router's navigate function; the exact API depends on
      // your router (react-router's `useNavigate`, TanStack Router's
      // `router.navigate`, etc.). Do NOT use `window.location.pathname = ...`
      // — it triggers a full page reload and kills the agent stream,
      // destroying chat state mid-run.
      navigate(path);
      return { ok: true };
    },
  });

  useHumanInTheLoop({
    name: "confirmDelete",
    description: "Ask the user to confirm a destructive action",
    parameters: z.object({ label: z.string() }),
    render: ({ args, status, respond }) =>
      status === "executing" ? (
        <div>
          Delete {args.label}?
          <button onClick={() => respond({ ok: true })}>Yes</button>
          <button onClick={() => respond({ ok: false })}>No</button>
        </div>
      ) : null,
  });

  return null;
}
```

### Reading agent state in a SPA

```tsx
import { useAgent, useAgentContext } from "@copilotkit/react-core/v2";

function Panel() {
  useAgentContext({
    description: "Current page URL",
    value: window.location.href,
  });

  const { agent } = useAgent({ agentId: "default" });
  return (
    <div>
      State: {JSON.stringify(agent?.state)} —{" "}
      {agent?.isRunning ? "running" : "idle"}
    </div>
  );
}
```

`useAgent` returns `{ agent }` only — `agent` may be `undefined` while the
runtime is still loading, so guard with optional chaining. Access
`isRunning` via the agent instance itself.

Source: packages/react-core/src/v2/hooks/use-agent.tsx:333-335

## Common Mistakes

### CRITICAL reaching for selfManagedAgents as a production SPA path

Wrong:

```tsx
// SPA with no backend, trying to avoid CopilotKit Cloud:
<CopilotKitProvider
  selfManagedAgents={{
    default: new BuiltInAgent({ apiKey: "sk-live-..." }),
  }}
/>
```

Correct:

```tsx
// For a SPA without a runtime, the ONLY production path is CopilotKit Cloud:
<CopilotKitProvider publicApiKey="ck_pub_..." />
// If you control a backend, use a runtime instead:
<CopilotKitProvider runtimeUrl="/api/copilotkit" />
```

`selfManagedAgents` and `agents__unsafe_dev_only` are aliases — merged at
`CopilotKitProvider.tsx:393` with no auth gating. Any agent constructed in
the browser has its API key visible in the bundle. The benign-sounding name
"selfManagedAgents" is the trap: it is NOT production-safe. Both props
exist purely for local-dev demos.

Source: packages/react-core/src/v2/providers/CopilotKitProvider.tsx:136-138,393

### CRITICAL using agents\_\_unsafe_dev_only in production

Wrong:

```tsx
<CopilotKitProvider
  agents__unsafe_dev_only={{
    default: new BuiltInAgent({ apiKey: process.env.OPENAI_API_KEY }),
  }}
/>
```

Correct:

```tsx
<CopilotKitProvider publicApiKey="ck_pub_..." />
```

The `__unsafe_dev_only` suffix is a warning, not a safety belt — nothing
prevents the prop from shipping. Any API key referenced from browser code
ends up in the bundle.

Source: packages/react-core/src/v2/providers/CopilotKitProvider.tsx:136-138,393

### HIGH passing both runtimeUrl and publicApiKey

Wrong:

```tsx
<CopilotKitProvider runtimeUrl="/api/x" publicApiKey="ck_pub_..." />
```

Correct:

```tsx
// Cloud-only SPA:
<CopilotKitProvider publicApiKey="ck_pub_..." />
// Or own runtime, not both:
<CopilotKitProvider runtimeUrl="/api/copilotkit" />
```

`runtimeUrl` wins when both are present — the Cloud call is never issued,
and the hardcoded public key sits in the bundle for no reason.

Source: docs/snippets/shared/troubleshooting/common-issues.mdx:30-42

### LOW publicApiKey vs publicLicenseKey — pick one

`publicApiKey` is canonical; `publicLicenseKey` is an accepted alias.
Resolution order:

```ts
// packages/react-core/src/v2/providers/CopilotKitProvider.tsx:391
const resolvedPublicKey = publicApiKey ?? publicLicenseKey;
```

`publicApiKey` wins when both are set. Prefer `publicApiKey` in new code
for consistency with the HTTP header name (`X-CopilotCloud-Public-Api-Key`)
and the Cloud dashboard label.

Source: packages/react-core/src/v2/providers/CopilotKitProvider.tsx:122-128,391

### LOW over-configuring SSR in a pure SPA

Wrong:

```tsx
// Dynamic-import gymnastics in a pure Vite SPA:
const CopilotChat = React.lazy(() =>
  import("@copilotkit/react-core/v2").then((m) => ({ default: m.CopilotChat })),
);
```

Correct:

```tsx
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
// Just render it at the top level; no SSR concerns in a Vite SPA.
```

`@copilotkit/react-core/v2` is marked `"use client"` — SSR is not in scope.
A pure SPA has no server render path; the normal import is correct.

Source: packages/react-core/src/v2/index.ts:1
