---
name: human-in-the-loop
description: >
  Gate tool execution behind user approval via useHumanInTheLoop. The
  synthesized handler returns a Promise that ONLY resolves when
  respond(result) is called. Never calling respond (including reject paths)
  hangs the agent run forever and keeps the thread locked. respond is
  undefined outside status === "executing". Unmounting mid-executing
  abandons the run. Status values are camelCase 'inProgress' | 'executing' |
  'complete'. Same UI-kit rule as client-side-tools. Load when gating
  destructive actions, prompting for input mid-run, or building approval
  modals.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
  - copilotkit/client-side-tools
  - copilotkit/rendering-tool-calls
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/types/human-in-the-loop.ts"
---

# CopilotKit Human-in-the-Loop (React)

This skill builds on `copilotkit/provider-setup`, `copilotkit/client-side-tools`,
and `copilotkit/rendering-tool-calls`.

`useHumanInTheLoop` is `useFrontendTool` minus the `handler` plus a
`render` that receives a `respond` function. The hook synthesizes a
Promise-based handler — the Promise resolves when `respond(result)` is
called. No `respond` call → infinite hang.

Status is camelCase: `"inProgress" | "executing" | "complete"`. `respond`
is `undefined` except during `"executing"`.

## UI-kit detection rule

Before writing the approval UI, check the consumer's `package.json` for a
UI kit (shadcn `AlertDialog`, MUI `Dialog`, Chakra `Modal`, Ant `Modal`,
Mantine `Modal`) and reuse it. Don't hand-roll an overlay.

## Setup

```tsx
"use client";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteConfirmHITL() {
  useHumanInTheLoop({
    name: "confirmDelete",
    description: "Confirm a destructive delete with the user",
    parameters: z.object({ id: z.string(), label: z.string() }),
    render: ({ status, args, respond }) => (
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {args.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={status !== "executing"}
              onClick={() => respond?.("denied")}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={status !== "executing"}
              onClick={() => respond?.("approved")}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  });
  return null;
}
```

## Core Patterns

### Always call `respond` in every branch

```tsx
render: ({ status, args, respond }) => {
  if (status !== "executing" || !respond) {
    return <div>Awaiting decision…</div>;
  }
  return (
    <div>
      <button onClick={() => respond("approved")}>Approve</button>
      <button onClick={() => respond("denied")}>Reject</button>
      <button onClick={() => respond({ action: "skip", reason: "timeout" })}>
        Skip
      </button>
    </div>
  );
};
```

### Abort the run on unmount so threads unlock

```tsx
import { useAgent } from "@copilotkit/react-core/v2";
import { useEffect } from "react";

function HITLHost() {
  const { agent, isRunning } = useAgent({ agentId: "default" });
  useEffect(() => {
    return () => {
      if (isRunning) agent.abortRun();
    };
  }, [agent, isRunning]);
  return <DeleteConfirmHITL />;
}
```

### Collect structured user input mid-run

```tsx
useHumanInTheLoop({
  name: "askUserForPriority",
  parameters: z.object({ taskId: z.string() }),
  render: ({ status, args, respond }) => {
    if (status !== "executing" || !respond) return <div>Waiting…</div>;
    return (
      <div>
        {["low", "medium", "high"].map((p) => (
          <button
            key={p}
            onClick={() => respond({ taskId: args.taskId, priority: p })}
          >
            {p}
          </button>
        ))}
      </div>
    );
  },
});
```

## Common Mistakes

### CRITICAL — Never calling `respond()`

Wrong:

```tsx
useHumanInTheLoop({
  name: "confirmDelete",
  parameters: z.object({ id: z.string() }),
  render: ({ args, status, respond }) => (
    <div>
      <p>Delete {args.id}?</p>
      <button>OK</button>
    </div>
  ),
});
```

Correct:

```tsx
useHumanInTheLoop({
  name: "confirmDelete",
  parameters: z.object({ id: z.string() }),
  render: ({ args, status, respond }) => (
    <div>
      <p>Delete {args.id}?</p>
      <button onClick={() => respond?.("approved")}>OK</button>
      <button onClick={() => respond?.("denied")}>Cancel</button>
    </div>
  ),
});
```

The synthesized handler returns a Promise that resolves only when `respond`
is called. Never calling it (including reject / cancel paths) hangs the
run indefinitely and leaves the thread locked on the server.

Source: `packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx:13-26`

### CRITICAL — Writing a custom overlay when the app has a Dialog primitive

Wrong:

```tsx
render: ({ respond }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }}>
    …
  </div>
);
```

Correct:

```tsx
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

render: ({ respond }) => (
  <AlertDialog open>
    <AlertDialogContent>
      …
      <AlertDialogAction onClick={() => respond?.("approved")}>
        OK
      </AlertDialogAction>
    </AlertDialogContent>
  </AlertDialog>
);
```

Check `package.json` for shadcn / MUI / Chakra / Ant / Mantine before
writing an overlay. Their dialog primitives handle focus trapping,
escape-to-close, and accessibility — raw JSX skips all of that.

Source: maintainer interview (Phase 2c)

### HIGH — Calling `respond` during `inProgress` or `complete`

Wrong:

```tsx
render: ({ status, respond }) => (
  <button onClick={() => (respond as any)("yes")}>Yes</button>
);
```

Correct:

```tsx
render: ({ status, respond }) =>
  status === "executing" && respond ? (
    <button onClick={() => respond("yes")}>Yes</button>
  ) : (
    <p>Waiting…</p>
  );
```

`respond` is `undefined` outside `status === "executing"`. Widening it to
`any` silently no-ops — the button click appears to work, but nothing
resolves the Promise.

Source: `packages/react-core/src/v2/types/human-in-the-loop.ts:8-32`

### HIGH — Unmounting the render mid-executing

Wrong:

```tsx
// User clicks away to a different route while the agent is waiting on respond()
```

Correct:

```tsx
// Keep the HITL prompt at a layout level that persists across route changes, OR abort on unmount:
const { agent, isRunning } = useAgent({ agentId: "default" });
useEffect(
  () => () => {
    if (isRunning) agent.abortRun();
  },
  [agent, isRunning],
);
```

`useHumanInTheLoop` removes its renderer on unmount (unlike
`useFrontendTool`, which keeps renderers for history). If the renderer
unmounts mid-`executing`, the pending Promise is abandoned and the run
hangs. Either lift the HITL UI to a layout-level component, or abort the
run on unmount.

Source: `packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx:76-80`

### MEDIUM — Using hyphenated `"in-progress"` status

Wrong:

```tsx
render: ({ status }) => (status === "in-progress" ? <Spinner /> : <Form />);
```

Correct:

```tsx
render: ({ status }) => (status === "inProgress" ? <Spinner /> : <Form />);
```

Same camelCase rule as `rendering-tool-calls`: the discriminated union
only matches `"inProgress" | "executing" | "complete"`.

Source: `packages/react-core/src/v2/types/human-in-the-loop.ts:8-32`
