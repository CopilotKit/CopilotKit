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

### Anchor the inspector on narrow viewports

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" inspectorDefaultAnchor="bottom-left" />
```

### Env-gate the inspector

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" enableInspector={false} />
```

## Common Mistakes

### HIGH — Using `showDevConsole` to control the Inspector

Wrong:

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" showDevConsole="auto" />
```

Correct:

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" enableInspector={false} />
```

`showDevConsole` no longer controls Inspector visibility. Use
`enableInspector={false}` to disable the development default; production is
always guarded.

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
// App embedded in a sandboxed iframe with showDevConsole on
<CopilotKit runtimeUrl="..." showDevConsole="auto" />
```

Correct:

```tsx
<CopilotKit
  runtimeUrl="..."
  showDevConsole={typeof window !== "undefined" && window.self === window.top}
/>
```

The inspector persists its anchor via `localStorage`. In sandboxed iframes
without storage access, the component throws on mount. Either disable in
iframes or whitelist storage in the sandbox attrs.

Source: `packages/react-core/src/v2/components/CopilotKitInspector.tsx:16-53`
