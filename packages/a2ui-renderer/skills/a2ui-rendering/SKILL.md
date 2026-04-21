---
name: a2ui-rendering
description: >
  Render A2UI (Agent-to-UI declarative surfaces) in CopilotKit v2. Enable the
  runtime via CopilotRuntime({ a2ui: {...} }), then enable the provider via
  <CopilotKitProvider a2ui={{ theme }}>. Auto-activates via /info — do NOT
  manually pass renderActivityMessages. createA2UIMessageRenderer ships from
  @copilotkit/react-core/v2; low-level primitives (A2UIProvider, A2UIRenderer,
  createCatalog) ship from @copilotkit/a2ui-renderer. Covers theme
  customization, createSurface dedup, action-bridge try/finally cleanup. Load
  when an agent emits A2UI operations (createSurface / updateComponents /
  updateDataModel), when wiring a2ui on CopilotRuntime, or when styling A2UI
  surfaces.
type: framework
library: copilotkit
framework: react
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
  - copilotkit/setup-endpoint
sources:
  - "CopilotKit/CopilotKit:packages/a2ui-renderer/src/index.ts"
  - "CopilotKit/CopilotKit:packages/a2ui-renderer/src/react-renderer/index.ts"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/a2ui/A2UIMessageRenderer.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/providers/CopilotKitProvider.tsx"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/runtime.ts"
---

This skill builds on copilotkit/provider-setup and copilotkit/setup-endpoint.
Read those first for the CopilotKitProvider / CopilotRuntime fundamentals.

## Setup

A2UI has two halves. The runtime declares a2ui middleware; the client enables
the a2ui prop on the provider. Once both are set, `/info` flags A2UI and the
client auto-mounts `createA2UIMessageRenderer` — you do NOT wire
`renderActivityMessages` yourself.

### Runtime side (`app/routes/api.copilotkit.$.tsx`)

```tsx
import type { Route } from "./+types/api.copilotkit.$";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const agent = new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      abortController,
    });
  },
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  // Enabling this key causes /info to advertise A2UI to the client.
  a2ui: {},
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export async function loader({ request }: Route.LoaderArgs) {
  return handler(request);
}
export async function action({ request }: Route.ActionArgs) {
  return handler(request);
}
```

### Client side (`app/root.tsx` or the app shell)

```tsx
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export default function App() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      a2ui={{
        theme: {
          // Theme object forwarded to A2UIProvider → ThemeProvider.
          // Tokens map to A2UI's basic catalog CSS vars.
          colors: { primary: "#0ea5e9" },
        },
      }}
    >
      <CopilotChat agentId="default" className="h-full" />
    </CopilotKitProvider>
  );
}
```

## Core Patterns

### Custom catalog

Pass a custom catalog to extend the built-in component set. `createCatalog`
and `extractSchema` let the agent see what components it may render.

```tsx
import {
  createCatalog,
  extractSchema,
  basicCatalog,
} from "@copilotkit/a2ui-renderer";

const theme = { colors: { primary: "#0ea5e9" } };

const catalog = createCatalog({
  ...basicCatalog,
  ProductCard: {
    schema: extractSchema<{ title: string; price: number }>(),
    render: ({ title, price }) => (
      <div className="rounded-xl border p-3">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">${price}</div>
      </div>
    ),
  },
});

<CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ theme, catalog }}>
  <CopilotChat agentId="default" />
</CopilotKitProvider>;
```

### Override the loading skeleton

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  a2ui={{
    theme,
    loadingComponent: () => <div className="animate-pulse">Building UI…</div>,
  }}
>
  <CopilotChat agentId="default" />
</CopilotKitProvider>
```

## Common Mistakes

### CRITICAL forgetting runtime.a2ui

Wrong:

```tsx
// server
new CopilotRuntime({ agents: { default: agent } });
// client
<CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ theme }} />;
```

Correct:

```tsx
// server
new CopilotRuntime({ agents: { default: agent }, a2ui: {} });
// client
<CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ theme }} />;
```

Without `runtime.a2ui`, `/info` never flags A2UI and the provider's a2ui prop
silently no-ops — the renderer never mounts.

Source: packages/runtime/src/v2/runtime/core/runtime.ts:55-58,217,242

### HIGH manually wiring renderActivityMessages for A2UI

Wrong:

```tsx
import { createA2UIMessageRenderer } from "@copilotkit/react-core/v2";

<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  renderActivityMessages={[createA2UIMessageRenderer({ theme })]}
/>;
```

Correct:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ theme }} />
```

CopilotKitProvider auto-detects runtime A2UI via `/info` and injects the
built-in renderer. Passing it through `renderActivityMessages` duplicates the
renderer and can race with the auto-injected one.

Source: packages/react-core/src/v2/providers/CopilotKitProvider.tsx:188-222,294-296

### MEDIUM re-emitting createSurface on every snapshot

Wrong:

```python
# Pseudocode — inside your agent generator. Exact API names/kwargs vary by
# A2UI SDK version; consult your SDK's docs for real call shapes.
async def agent_generator():
    # agent re-emits createSurface operation on every state delta
    async for update in stream:
        yield a2ui.create_surface(surface_id="main", ...)  # every tick
        yield a2ui.update_components(...)
```

Correct:

```python
# Pseudocode — inside your agent generator.
# Emit createSurface once per surfaceId; use updateComponents / updateDataModel
# for changes.
async def agent_generator():
    yield a2ui.create_surface(surface_id="main", ...)  # once
    async for update in stream:
        yield a2ui.update_components(surface_id="main", ...)
```

The MessageProcessor dedups on `surfaceId` but re-emitting is an agent-side
bug — the client re-runs reconciliation logic for nothing and flickers.

Source: packages/react-core/src/v2/a2ui/A2UIMessageRenderer.tsx:218-226

### MEDIUM custom action bridge without a2uiAction cleanup

Wrong:

```ts
copilotkit.setProperties({ ...copilotkit.properties, a2uiAction: msg });
await copilotkit.runAgent({ agent });
// no finally — a2uiAction leaks into the next run's properties
```

Correct:

```ts
try {
  copilotkit.setProperties({ ...copilotkit.properties, a2uiAction: msg });
  await copilotkit.runAgent({ agent });
} finally {
  if (copilotkit.properties) {
    const { a2uiAction, ...rest } = copilotkit.properties;
    copilotkit.setProperties(rest);
  }
}
```

The built-in bridge always strips `a2uiAction` in `finally`, guarded by a
`copilotkit.properties` null-check so it can't mask the original `runAgent`
error with a `TypeError` during destructuring. Skipping cleanup keeps the
previous action attached to subsequent runs.

Source: packages/react-core/src/v2/a2ui/A2UIMessageRenderer.tsx:146-167

### MEDIUM installing @copilotkitnext/a2ui-renderer

Wrong:

```ts
import { createA2UIMessageRenderer } from "@copilotkitnext/a2ui-renderer";
```

Correct:

```ts
// Low-level primitives (rarely needed — CopilotKitProvider a2ui prop is the default path):
import {
  A2UIProvider,
  A2UIRenderer,
  createCatalog,
} from "@copilotkit/a2ui-renderer";
// Auto-mounted renderer lives in react-core/v2:
import { createA2UIMessageRenderer } from "@copilotkit/react-core/v2";
```

This package ships as `@copilotkit/a2ui-renderer`, not
`@copilotkitnext/a2ui-renderer`. The `@copilotkitnext/` scope is reserved
for other packages that ship under it separately — do not assume it applies
here.

Source: packages/a2ui-renderer/package.json
