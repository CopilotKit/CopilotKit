---
name: debug-mode
description: >
  Enable client-side debug tooling via showDevConsole ('auto' | true | false)
  and the debug prop (DebugConfig = { events, lifecycle, verbose }). The web
  inspector lazy-loads @copilotkit/web-inspector via @lit-labs/react. Load
  when turning on the inspector for local dev, logging full message
  payloads during a bug repro, or keeping dev tooling out of production.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/providers/CopilotKitProvider.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/CopilotKitInspector.tsx"
  - "CopilotKit/CopilotKit:packages/web-inspector/src/index.ts"
---

# CopilotKit Debug Mode (React)

This skill builds on `copilotkit/provider-setup`. Both debug surfaces are
props on `CopilotKitProvider`.

Two independent knobs:

1. `showDevConsole` mounts the visual web inspector (floating panel).
2. `debug` controls console logging for the event pipeline.

Both should be `'auto'` / off in production.

## Setup

```tsx
"use client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole="auto"
      debug={{ events: true, lifecycle: true, verbose: false }}
    >
      {children}
    </CopilotKitProvider>
  );
}
```

`showDevConsole="auto"` enables the inspector only on `localhost` and
`127.0.0.1`. In production it evaluates to `false`.

## Core Patterns

### Full payload logging during a repro

`debug: true` enables `events + lifecycle` but keeps `verbose` off to avoid
leaking PII by default. For a bug repro, explicitly set `verbose: true` to
dump full message/tool-call payloads.

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  debug={{ events: true, lifecycle: true, verbose: true }}
/>
```

### Anchor the inspector on narrow viewports

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  showDevConsole="auto"
  inspectorDefaultAnchor="bottom-left"
/>
```

### Env-gate the inspector

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  showDevConsole={process.env.NODE_ENV !== "production"}
/>
```

## Common Mistakes

### HIGH — Shipping `showDevConsole={true}` to production

Wrong:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole={true} />
```

Correct:

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto" />
// "auto" enables only on localhost / 127.0.0.1
```

A hard `true` ships the Lit + markdown bundle to every end user and exposes
a developer panel in production. `"auto"` is the right default.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx:301-321`

### MEDIUM — Expecting `debug: true` to log full payloads

Wrong:

```tsx
<CopilotKitProvider debug={true} />
// Then wondering why message contents aren't in the console
```

Correct:

```tsx
<CopilotKitProvider debug={{ events: true, lifecycle: true, verbose: true }} />
```

`debug: true` is shorthand for `{ events: true, lifecycle: true, verbose: false }`.
`verbose` defaults to `false` to avoid logging user message bodies / tool
arguments / state snapshots — it must be opted into explicitly.

Source: `docs/snippets/shared/troubleshooting/debug-mode.mdx:85-93`

### MEDIUM — Passing fields that aren't in `DebugConfig`

Wrong:

```tsx
<CopilotKitProvider debug={{ events: true, network: true, errors: true }} />
```

Correct:

```tsx
<CopilotKitProvider debug={{ events: true, lifecycle: true, verbose: true }} />
```

`DebugConfig` has exactly three fields: `events`, `lifecycle`, `verbose`.
Anything else is silently ignored by the type-narrowing at the provider.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx` (DebugConfig type)

### MEDIUM — Inspector crashing in sandboxed iframes

Wrong:

```tsx
// App embedded in a sandboxed iframe with showDevConsole on
<CopilotKitProvider runtimeUrl="..." showDevConsole="auto" />
```

Correct:

```tsx
<CopilotKitProvider
  runtimeUrl="..."
  showDevConsole={typeof window !== "undefined" && window.self === window.top}
/>
```

The inspector persists its anchor via `localStorage`. In sandboxed iframes
without storage access, the component throws on mount. Either disable in
iframes or whitelist storage in the sandbox attrs.

Source: `packages/react-core/src/v2/components/CopilotKitInspector.tsx:16-53`
