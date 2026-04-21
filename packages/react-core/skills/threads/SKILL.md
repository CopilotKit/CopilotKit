---
name: threads
description: >
  List / rename / archive / delete durable Intelligence threads via
  useThreads. Returns { threads, isLoading, error, hasMoreThreads,
  fetchMoreThreads, renameThread, archiveThread, deleteThread }.
  Intelligence-mode only — in SSE mode the hook errors with "Runtime URL is
  not configured". deleteThread is irreversible (use archiveThread for
  soft-delete UX). Load when building a thread sidebar, thread-switcher UI,
  or an archived-threads view.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/agent-access
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-threads.tsx"
---

# CopilotKit Threads (React)

This skill builds on `copilotkit/agent-access`. Durable threads only exist
in Intelligence mode — a runtime pointed at `api.cloud.copilotkit.ai` or a
self-managed Intelligence instance. In plain SSE mode the hook errors.

## Setup

```tsx
"use client";
import { useThreads } from "@copilotkit/react-core/v2";

export function ThreadSidebar({ agentId }: { agentId: string }) {
  const {
    threads,
    isLoading,
    error,
    hasMoreThreads,
    fetchMoreThreads,
    renameThread,
    archiveThread,
    deleteThread,
  } = useThreads({ agentId });

  if (error) return <div className="text-red-500">{error.message}</div>;
  if (isLoading) return <div>Loading threads…</div>;

  return (
    <ul className="space-y-1">
      {threads.map((t) => (
        <li key={t.id} className="flex gap-2">
          <span>{t.name ?? "Untitled"}</span>
          <button onClick={() => renameThread(t.id, "Renamed")}>Rename</button>
          <button onClick={() => archiveThread(t.id)}>Archive</button>
        </li>
      ))}
      {hasMoreThreads && <button onClick={fetchMoreThreads}>Load more</button>}
    </ul>
  );
}
```

## Core Patterns

### Paginated list

```tsx
const { threads, hasMoreThreads, fetchMoreThreads, isFetchingMoreThreads } =
  useThreads({ agentId: "default", limit: 25 });
```

### Include archived threads

```tsx
const { threads: archived } = useThreads({
  agentId: "default",
  includeArchived: true,
});
```

### Optimistic archive with error rollback

```tsx
const { threads, archiveThread } = useThreads({ agentId: "default" });

async function onArchive(id: string) {
  try {
    await archiveThread(id);
    toast.success("Archived");
  } catch (err) {
    toast.error(`Failed to archive: ${String(err)}`);
  }
}
```

### Thread-switcher + `<CopilotChat>`

```tsx
import { CopilotChat, useThreads } from "@copilotkit/react-core/v2";
import { useState } from "react";

export function ThreadSwitcher() {
  const { threads } = useThreads({ agentId: "default" });
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-[200px_1fr]">
      <ul>
        {threads.map((t) => (
          <li key={t.id}>
            <button onClick={() => setActiveId(t.id)}>
              {t.name ?? "Untitled"}
            </button>
          </li>
        ))}
      </ul>
      {activeId && (
        <CopilotChat key={activeId} agentId="default" threadId={activeId} />
      )}
    </div>
  );
}
```

## Common Mistakes

### HIGH — Using `useThreads` with an SSE-only runtime

Wrong:

```tsx
// Runtime has no Intelligence configured
new CopilotRuntime({ agents });

// Client side:
const { threads, error } = useThreads({ agentId: "default" });
// error: "Runtime URL is not configured" or empty list forever
```

Correct:

```ts
// Server — upgrade to Intelligence mode:
import {
  CopilotIntelligenceRuntime,
  CopilotKitIntelligence,
} from "@copilotkit/runtime/v2";

const intelligence = new CopilotKitIntelligence({
  apiUrl: process.env.COPILOTKIT_INTELLIGENCE_API_URL!,
  wsUrl: process.env.COPILOTKIT_INTELLIGENCE_WS_URL!,
  apiKey: process.env.COPILOTKIT_INTELLIGENCE_API_KEY!,
  organizationId: process.env.COPILOTKIT_ORG_ID!,
});

const runtime = new CopilotIntelligenceRuntime({
  agents,
  intelligence,
  identifyUser: async (req) => ({ userId: await getUserId(req) }),
});
```

`CopilotKitIntelligence` and `CopilotIntelligenceRuntime` are only exposed
on the `@copilotkit/runtime/v2` subpath — the package root exports SSE
primitives only.

Thread routes only exist in Intelligence mode. In plain SSE the list fetch
fails and mutations reject.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:207-213,229`

### HIGH — Expecting `deleteThread` to be recoverable

Wrong:

```tsx
await deleteThread(id); // user expected a trash bin
```

Correct:

```tsx
// For soft-delete UX, use archive:
await archiveThread(id);

// Then expose archived threads in a separate view:
const { threads: archived } = useThreads({
  agentId: "default",
  includeArchived: true,
});
```

`deleteThread` is irreversible at the Intelligence platform level. Use
`archiveThread` for user-facing delete UX and only call `deleteThread` for
genuine "permanently erase" flows.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:101-105`

### MEDIUM — Assuming archived threads appear by default

Wrong:

```tsx
const { threads } = useThreads({ agentId: "default" });
// User archived a thread. User opens the "Archived" tab. It's empty.
```

Correct:

```tsx
const { threads: activeThreads } = useThreads({ agentId: "default" });
const { threads: archivedThreads } = useThreads({
  agentId: "default",
  includeArchived: true,
});
```

`includeArchived` defaults to `false`. Archived threads are filtered out of
the default list; opt in explicitly for an archived-view tab.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:60-62`

### MEDIUM — Not handling `error`

Wrong:

```tsx
const { threads } = useThreads({ agentId: "default" });
return <ul>{threads.map(...)}</ul>;
// Silent failures — handshake errors, network errors all vanish.
```

Correct:

```tsx
const { threads, isLoading, error } = useThreads({ agentId: "default" });
if (error) return <ErrorBanner message={error.message} />;
if (isLoading) return <Spinner />;
return <ul>{threads.map(...)}</ul>;
```

`error` holds the most recent fetch/mutation error until the next
successful fetch clears it. Surface it or you'll miss Intelligence-mode
mis-configuration.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:70-74`
