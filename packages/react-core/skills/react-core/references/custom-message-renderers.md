# CopilotKit Custom Message Renderers (React)

This skill builds on `copilotkit/provider-setup` and
`copilotkit/chat-components`. `useRenderCustomMessages` is consumed
internally by `<CopilotChat>` / `<CopilotChatView>`.

Key rules:

- Renderers are passed to `CopilotKitProvider` via `renderCustomMessages`.
- The hook returns `null` when called outside `CopilotChatConfigurationProvider`.
- First non-null result wins — agent-scoped renderers evaluated first.
- `stateSnapshot` is `undefined` before the run's `runId` resolves.

## Setup

```tsx
"use client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import type { ReactCustomMessageRenderer } from "@copilotkit/react-core/v2";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";

const CopyButton: ReactCustomMessageRenderer = {
  render: ({ message, position }) => {
    if (position !== "after") return null;
    if (message.role !== "assistant") return null;
    const content = typeof message.content === "string" ? message.content : "";
    if (!content) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigator.clipboard.writeText(content)}
      >
        Copy
      </Button>
    );
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const renderers = useMemo(() => [CopyButton], []);
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      renderCustomMessages={renderers}
    >
      {children}
    </CopilotKitProvider>
  );
}
```

## Core Patterns

### State-snapshot viewer after completed runs

```tsx
const StateSnapshotRenderer: ReactCustomMessageRenderer = {
  render: ({ message, position, stateSnapshot }) => {
    if (position !== "after") return null;
    if (message.role !== "assistant") return null;
    if (!stateSnapshot) return null; // run not yet resolved
    return (
      <details>
        <summary>Agent state</summary>
        <pre>{JSON.stringify(stateSnapshot, null, 2)}</pre>
      </details>
    );
  },
};
```

### Agent-scoped renderer

```tsx
const ResearchNotes: ReactCustomMessageRenderer = {
  agentId: "research",
  render: ({ message, position, stateSnapshot }) => {
    if (position !== "after" || !stateSnapshot) return null;
    const notes = (stateSnapshot as { notes?: string[] }).notes ?? [];
    return (
      <ul>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    );
  },
};
```

### Debug panel before user messages

```tsx
const DebugBefore: ReactCustomMessageRenderer = {
  render: ({ message, position, messageIndex, runId }) => {
    if (position !== "before" || message.role !== "user") return null;
    // `runId` is always a string, but it falls back to a synthetic
    // "missing-run-id:<messageId>" value before a run is registered.
    // Slice only when it looks like a real id, otherwise show a dash.
    const shortId = runId?.startsWith("missing-run-id:")
      ? "—"
      : (runId?.slice(0, 6) ?? "—");
    return (
      <div style={{ opacity: 0.5, fontSize: 11 }}>
        #{messageIndex} · run {shortId}
      </div>
    );
  },
};
```

## Common Mistakes

### HIGH — Using the hook outside a chat configuration provider

Wrong:

```tsx
// Component mounted outside <CopilotChat>/<CopilotChatView>
function StandaloneRenderer() {
  const render = useRenderCustomMessages(); // returns null — no chat config in tree
  return render ? render({ message, position: "after" }) : null;
}
```

Correct:

```tsx
// Option A — register renderers via the provider prop so <CopilotChat> picks them up:
<CopilotKitProvider renderCustomMessages={renderers}>
  <CopilotChat agentId="default" />
</CopilotKitProvider>;

// Option B — call the hook only inside a chat-configured subtree:
import { CopilotChatConfigurationProvider } from "@copilotkit/react-core/v2";
<CopilotChatConfigurationProvider agentId="default">
  <ComponentThatCallsUseRenderCustomMessages />
</CopilotChatConfigurationProvider>;
```

`useRenderCustomMessages` returns `null` when there is no
`CopilotChatConfigurationProvider` in the tree. `<CopilotChat>` wraps its
children in one automatically; direct use outside a chat component
requires the explicit wrapper.

Source: `packages/react-core/src/v2/hooks/use-render-custom-messages.tsx:15-17`

### MEDIUM — Relying on `stateSnapshot` during early streaming

Wrong:

```tsx
render: ({ stateSnapshot }) => <pre>{JSON.stringify(stateSnapshot.items)}</pre>;
// Crashes during the first token — stateSnapshot is undefined before runId resolves.
```

Correct:

```tsx
render: ({ stateSnapshot }) => (
  <pre>{stateSnapshot ? JSON.stringify(stateSnapshot.items) : "…"}</pre>
);
```

`stateSnapshot` comes from `copilotkit.getStateByRun(agentId, threadId,
runId)`. `runId` is `undefined` until the run is registered, so the
snapshot starts `undefined` and only becomes truthy after the first
state emit. Guard with a fallback.

Source: `packages/react-core/src/v2/hooks/use-render-custom-messages.tsx:69-71`

### MEDIUM — Expecting every renderer in the array to run

Wrong:

```tsx
// Both renderers want to add an "after assistant" button and return <div>…</div>
// Only the first one (or the agent-scoped one) fires — the second is skipped.
const renderers = [Renderer1, Renderer2];
```

Correct:

```tsx
// Merge the two into a single renderer that returns one element:
const Combined: ReactCustomMessageRenderer = {
  render: (props) => (
    <div className="flex gap-1">
      <Renderer1Inner {...props} />
      <Renderer2Inner {...props} />
    </div>
  ),
};
```

The hook iterates the sorted renderer list and breaks at the first non-null
result. Two independent renderers returning JSX for the same
`(message, position)` pair will have only one fire. Compose them into a
single renderer if you want both to appear.

Source: `packages/react-core/src/v2/hooks/use-render-custom-messages.tsx:73-95`

### MEDIUM — Memoization miss on `renderCustomMessages` array

Wrong:

```tsx
<CopilotKitProvider
  renderCustomMessages={[CopyButton, DebugBefore]} // fresh array every render
/>
```

Correct:

```tsx
const renderers = useMemo(() => [CopyButton, DebugBefore], []);
<CopilotKitProvider renderCustomMessages={renderers} />;
```

The provider's stable-array-prop diff console-errors when a new array
identity appears every render and thrashes renderer registration.
Memoize or hoist.

Source: `packages/react-core/src/v2/providers/CopilotKitProvider.tsx` (useStableArrayProp)
