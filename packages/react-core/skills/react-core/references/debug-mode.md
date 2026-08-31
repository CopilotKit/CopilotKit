# CopilotKit Debug Mode (React)

This skill builds on `copilotkit/provider-setup`. Both debug surfaces are
props on the `CopilotKit` provider (from `@copilotkit/react-core/v2`).

Two independent knobs:

1. `enableInspector` disables the development-only visual Inspector when set
   to `false`.
2. `debug` controls console logging for the event pipeline.

The Inspector is always off in production. Configure `debug` separately for
the logging behavior you need.

## Setup

```tsx
"use client";
import { CopilotKit } from "@copilotkit/react-core/v2";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      debug={{ events: true, lifecycle: true, verbose: false }}
    >
      {children}
    </CopilotKit>
  );
}
```

The Inspector is enabled automatically in development browser builds on any
host. Production builds never load it.

## Core Patterns

### Full payload logging during a repro

`debug: true` enables `events + lifecycle` but keeps `verbose` off to avoid
leaking PII by default. For a bug repro, explicitly set `verbose: true` to
dump full message/tool-call payloads.

```tsx
<CopilotKit
  runtimeUrl="/api/copilotkit"
  debug={{ events: true, lifecycle: true, verbose: true }}
/>
```

### Disable the Inspector in development

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" enableInspector={false} />
```

Use this when you want no Inspector FAB in local development. Production
builds never load the Inspector.

## Common Mistakes

### HIGH — Using `showDevConsole` to control the Inspector

Wrong:

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" showDevConsole="auto" />
```

Correct:

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" />
```

`showDevConsole` no longer controls Inspector visibility. Omit it. The
Inspector is on in development and off in production.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx:301-321`

### MEDIUM — Expecting `debug: true` to log full payloads

Wrong:

```tsx
<CopilotKit debug={true} />
// Then wondering why message contents aren't in the console
```

Correct:

```tsx
<CopilotKit debug={{ events: true, lifecycle: true, verbose: true }} />
```

`debug: true` is shorthand for `{ events: true, lifecycle: true, verbose: false }`.
`verbose` defaults to `false` to avoid logging user message bodies / tool
arguments / state snapshots — it must be opted into explicitly.

Source: `docs/snippets/shared/troubleshooting/debug-mode.mdx:85-93`

### MEDIUM — Passing fields that aren't in `DebugConfig`

Wrong:

```tsx
<CopilotKit debug={{ events: true, network: true, errors: true }} />
```

Correct:

```tsx
<CopilotKit debug={{ events: true, lifecycle: true, verbose: true }} />
```

`DebugConfig` has exactly three fields: `events`, `lifecycle`, `verbose`.
Anything else is silently ignored by the type-narrowing at the provider.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx` (DebugConfig type)

### MEDIUM — Inspector crashing in sandboxed iframes

Wrong:

```tsx
// App embedded in a sandboxed iframe with the development Inspector enabled
<CopilotKit runtimeUrl="..." />
```

Correct:

```tsx
<CopilotKit runtimeUrl="..." enableInspector={false} />
```

The inspector persists its anchor via `localStorage`. In sandboxed iframes
without storage access, `loadInspectorState` throws on mount. Disable it for
an iframe deployment or whitelist storage in the sandbox attrs.

Source: `packages/web-inspector/src/lib/persistence.ts` (`loadInspectorState`)
