---
name: spa-without-runtime
description: >
  Build a pure-client CopilotKit v2 SPA with NO server runtime by pointing
  CopilotKitProvider at CopilotKit Cloud via publicLicenseKey. This is the
  ONLY production-safe SPA path. Both agents__unsafe_dev_only and
  selfManagedAgents are dev-only aliases that leak credentials in production
  — never ship them. Covers Vite / plain React Router SPA wiring, getting a
  publicLicenseKey from cloud.copilotkit.ai, and the SSR non-concern.
  publicApiKey is a deprecated alias for publicLicenseKey — don't teach it
  in new code. Load when the user has no backend and wants chat in a
  pure-SPA deployment (Vite, GitHub Pages, S3, etc.).
type: lifecycle
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
  - copilotkit/0-to-working-chat
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/providers/CopilotKitProvider.tsx"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/common-issues.mdx"
  - "CopilotKit/CopilotKit:packages/core/src/core/core.ts"
---

## Setup

Obtain a `publicLicenseKey` from cloud.copilotkit.ai. In a Vite SPA:

```bash
# .env.local
VITE_CPK_LICENSE=ck_pub_xxxxxxxxxxxxxxxxxxxx
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
    handler: async () => ({ text: await navigator.clipboard.readText() }),
  });
  return null;
}

export default function App() {
  return (
    <CopilotKitProvider publicLicenseKey={import.meta.env.VITE_CPK_LICENSE}>
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
      window.location.pathname = path;
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

  const { agent, isRunning } = useAgent({ agentId: "default" });
  return (
    <div>
      State: {JSON.stringify(agent?.state)} — {isRunning ? "running" : "idle"}
    </div>
  );
}
```

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
<CopilotKitProvider publicLicenseKey="ck_pub_..." />
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
<CopilotKitProvider publicLicenseKey="ck_pub_..." />
```

The `__unsafe_dev_only` suffix is a warning, not a safety belt — nothing
prevents the prop from shipping. Any API key referenced from browser code
ends up in the bundle.

Source: packages/react-core/src/v2/providers/CopilotKitProvider.tsx:136-138,393

### HIGH passing both runtimeUrl and publicLicenseKey

Wrong:

```tsx
<CopilotKitProvider runtimeUrl="/api/x" publicLicenseKey="ck_pub_..." />
```

Correct:

```tsx
// Cloud-only SPA:
<CopilotKitProvider publicLicenseKey="ck_pub_..." />
// Or own runtime, not both:
<CopilotKitProvider runtimeUrl="/api/copilotkit" />
```

`runtimeUrl` wins when both are present — the Cloud call is never issued,
and the hardcoded public key sits in the bundle for no reason.

Source: docs/snippets/shared/troubleshooting/common-issues.mdx:30-42

### MEDIUM teaching publicApiKey in new SPA code

Wrong:

```tsx
<CopilotKitProvider publicApiKey="ck_pub_..." />
```

Correct:

```tsx
<CopilotKitProvider publicLicenseKey="ck_pub_..." />
```

`publicApiKey` is a deprecated alias accepted for v1 backward-compat
(`resolvedPublicKey = publicApiKey ?? publicLicenseKey`). Agents trained on
older docs default to `publicApiKey` — new code should use
`publicLicenseKey`.

Source: packages/react-core/src/v2/providers/CopilotKitProvider.tsx:391

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
