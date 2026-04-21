---
name: v1-to-v2-migration
description: >
  Authoritative v1 → v2 migration playbook for CopilotKit. NO official codemod
  ships — this skill IS the migration tool. Covers the full rename table
  (17+ entries), import-path rewrite to /v2 subpaths, hook rename/split
  (useCopilotAction → useFrontendTool + useHumanInTheLoop, useCoAgent →
  useAgent, useCopilotReadable → useAgentContext), CopilotKit →
  CopilotKitProvider, runtime endpoint port, CopilotKitErrorCode
  (SCREAMING_SNAKE) → CopilotKitCoreErrorCode (snake_case), imageUploadsEnabled
  → attachments, publicApiKey unchanged (publicLicenseKey accepted as alias),
  @copilotkit/react-ui chat
  components relocated to @copilotkit/react-core/v2. Load when the user has a
  v1 CopilotKit codebase and wants to upgrade, or when you encounter
  useCopilotAction / useCoAgent / useCopilotReadable / CopilotKit provider /
  @copilotkit/react-ui imports.
type: lifecycle
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
  - copilotkit/setup-endpoint
  - copilotkit/client-side-tools
  - copilotkit/human-in-the-loop
  - copilotkit/agent-access
  - copilotkit/debug-and-troubleshoot
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/index.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/index.ts"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/index.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/index.ts"
  - "CopilotKit/CopilotKit:packages/core/src/core/core.ts"
  - "CopilotKit/CopilotKit:packages/shared/src/utils/errors.ts"
  - "CopilotKit/CopilotKit:docs/snippets/shared/troubleshooting/migrate-to-v2.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/(root)/migration-guides/migrate-attachments.mdx"
---

## Setup

Packages do NOT rename for v2. v2 lives at the `/v2` subpath of the same
packages.

```ts
// v1
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

// v2
import {
  CopilotKitProvider,
  CopilotPopup,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
```

Two reference files ship with this skill:

- `references/rename-table.md` — full 17+-row rename table.
- `references/migration-playbook.md` — step-by-step agent-executable recipe.

Read both before executing the migration.

## Core Patterns

### Rename table (summary — full table in references/rename-table.md)

| v1 API                              | v2 API                            | Subpath                     |
| ----------------------------------- | --------------------------------- | --------------------------- |
| `CopilotKit` provider               | `CopilotKitProvider`              | `@copilotkit/react-core/v2` |
| `useCopilotAction` (data)           | `useFrontendTool`                 | `@copilotkit/react-core/v2` |
| `useCopilotAction` (render/HITL)    | `useHumanInTheLoop`               | `@copilotkit/react-core/v2` |
| `useCoAgent`                        | `useAgent`                        | `@copilotkit/react-core/v2` |
| `useCopilotReadable`                | `useAgentContext`                 | `@copilotkit/react-core/v2` |
| `CopilotKitErrorCode` (SCREAMING)   | `CopilotKitCoreErrorCode` (snake) | `@copilotkit/react-core/v2` |
| `publicApiKey` prop                 | `publicApiKey` (unchanged; canonical) — `publicLicenseKey` accepted as alias | provider prop               |
| `imageUploadsEnabled` prop          | `attachments={{ enabled: true }}` | `<CopilotChat>` prop        |
| `CopilotPopup` etc. from `react-ui` | same names from `react-core/v2`   | `@copilotkit/react-core/v2` |

### Import-path audit (grep for v1 imports)

```bash
grep -rE "from ['\"]@copilotkit/(react-core|react-ui|runtime)['\"]" src/
grep -rE "useCopilotAction|useCopilotReadable|useCoAgent|CopilotKit[^P]" src/
```

Any hit = v1 surface that needs migration. See
`references/migration-playbook.md` for the full Phase 1 audit script.

### Hook split — useCopilotAction → useFrontendTool + useHumanInTheLoop

`useCopilotAction` with `render` but no `handler` is a HITL surface and
splits into `useHumanInTheLoop`. With `handler` and no `render` it becomes
`useFrontendTool`. With both, you need one of each — this split requires
judgment and cannot be codemodded blindly.

```tsx
// v1
useCopilotAction({
  name: "sendEmail",
  description: "Send an email",
  parameters: [
    { name: "to", type: "string" },
    { name: "body", type: "string" },
  ],
  render: ({ args, status, handler }) =>
    status === "executing" ? (
      <button onClick={() => handler(args)}>Send to {args.to}</button>
    ) : null,
});

// v2 — approval flow, UI + respond()
import { z } from "zod";
useHumanInTheLoop({
  name: "sendEmail",
  description: "Send an email",
  parameters: z.object({ to: z.string(), body: z.string() }),
  render: ({ args, status, respond }) =>
    status === "executing" ? (
      <button onClick={async () => respond({ sent: await send(args) })}>
        Send to {args.to}
      </button>
    ) : null,
});
```

For a plain data tool (no user approval):

```tsx
useFrontendTool({
  name: "getLocation",
  description: "Return the user's city",
  parameters: z.object({}),
  handler: async () => ({ city: "SF" }),
});
```

### Provider rename

```tsx
// v1
import { CopilotKit } from "@copilotkit/react-core";
<CopilotKit runtimeUrl="/api/copilotkit" publicApiKey="...">
  {children}
</CopilotKit>;

// v2 (publicApiKey stays — it's the canonical v2 name; publicLicenseKey
// is an accepted alias and the two resolve as `publicApiKey ?? publicLicenseKey`.)
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
<CopilotKitProvider runtimeUrl="/api/copilotkit" publicApiKey="...">
  {children}
</CopilotKitProvider>;
```

### Error-code equality migration

```ts
// v1 (SCREAMING_SNAKE)
if (error.code === "API_NOT_FOUND") { /* ... */ }

// v2 (snake_case, via CopilotKitCoreErrorCode)
import type { CopilotKitCoreErrorCode } from "@copilotkit/react-core/v2";
<CopilotKitProvider
  onError={({ code }) => {
    if (code === "runtime_info_fetch_failed") { /* ... */ }
    if (code === "agent_thread_locked") { /* ... */ }
  }}
/>
```

Full v2 code catalog in `copilotkit/debug-and-troubleshoot` +
`references/error-codes.md` of that skill.

### Runtime endpoint port

```ts
// v1 — Next.js route.ts
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
const runtime = new CopilotRuntime({
  /* ... */
});
export const POST = async (req: Request) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};

// v2 — fetch-based, works on ANY runtime
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      /* ... */
    }),
  },
});
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
export const GET = handler;
export const POST = handler;
```

## Common Mistakes

### CRITICAL @copilotkitnext/ scope for non-Angular packages

Wrong:

```ts
import { CopilotKitProvider } from "@copilotkitnext/react-core";
import { CopilotRuntime } from "@copilotkitnext/runtime";
```

Correct:

```ts
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
// Only Angular uses the @copilotkitnext/ scope:
// import { ... } from "@copilotkitnext/angular";
```

ONLY `@copilotkitnext/angular` uses the `@copilotkitnext` scope. Every
other CopilotKit package is under `@copilotkit/`. Agents over-generalize
from the Angular example and hallucinate scope names like
`@copilotkitnext/react-core`, `@copilotkitnext/runtime`, etc. — all of
which resolve as unresolved modules or install as unrelated packages.
This is the most-seen v2 migration hallucination per the maintainer.

Source: packages/angular/package.json (the ONE @copilotkitnext package); all other packages/\*/package.json

### CRITICAL installing @copilotkit/react-ui for v2 chat

Wrong:

```ts
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
```

Correct:

```ts
import { CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
```

In v2, chat components ship from `@copilotkit/react-core/v2`.
`@copilotkit/react-ui` v2 is CSS-only (a stylesheet package).

Source: docs/snippets/shared/troubleshooting/migrate-to-v2.mdx:42-56

### CRITICAL importing v2 hooks from @copilotkit/react-core root

Wrong:

```ts
import { CopilotKit, useCopilotReadable } from "@copilotkit/react-core";
```

Correct:

```ts
import { CopilotKitProvider, useAgentContext } from "@copilotkit/react-core/v2";
```

The root of `@copilotkit/react-core` is the v1 surface; v2 ships under
`/v2`. Mixed imports compile but route through different implementations
with different semantics.

Source: packages/react-core/src/index.tsx:1-8

### CRITICAL useCopilotAction in v2

Wrong:

```tsx
useCopilotAction({ name, parameters, handler, render });
```

Correct:

```tsx
useFrontendTool({ name, parameters, handler });
useHumanInTheLoop({ name, parameters, render });
```

`useCopilotAction` is split into two v2 hooks — judgment required on
which side each v1 call belongs to.

Source: packages/react-core/src/v2/hooks/index.ts:5,9

### CRITICAL useCoAgent in v2

Wrong:

```tsx
const { state, setState, running } = useCoAgent({ name: "research" });
```

Correct:

```tsx
const { agent } = useAgent({ agentId: "research" });
const state = agent?.state;
const isRunning = agent?.isRunning;
agent?.setState({ ...agent.state, foo: "bar" });
```

`useAgent` returns `{ agent }` only — `agent` can be `undefined` while
the runtime is still loading, so guard with optional chaining. State,
`isRunning`, and mutation live on the agent instance itself.

Source: packages/react-core/src/v2/hooks/use-agent.tsx:333-335 (return { agent })

### HIGH checking against v1 SCREAMING_SNAKE error codes

Wrong:

```ts
if (error.code === "API_NOT_FOUND") {
  /* never matches */
}
```

Correct:

```ts
onError: ({ code }) => {
  if (code === "runtime_info_fetch_failed") {
    /* ... */
  }
};
```

v2 `CopilotKitCoreErrorCode` values are snake_case strings. v1
SCREAMING_SNAKE values never equal v2 codes.

Source: packages/core/src/core/core.ts:71-105; packages/shared/src/utils/errors.ts:44-57

### HIGH renaming @copilotkit/runtime imports to @copilotkit/runtime-v2

Wrong:

```ts
import { CopilotRuntime } from "@copilotkit/runtime-v2";
```

Correct:

```ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
```

The package didn't rename; v2 lives at the `/v2` subpath.

Source: packages/runtime/src/v2/index.ts:1-6

### MEDIUM imageUploadsEnabled in v2

Wrong:

```tsx
<CopilotChat imageUploadsEnabled />
```

Correct:

```tsx
<CopilotChat attachments={{ enabled: true }} />
```

Attachments API replaces the v1 image-upload prop; it supports images,
files, drag-and-drop, and paste.

Source: docs/content/docs/(root)/migration-guides/migrate-attachments.mdx

### MEDIUM installing @ag-ui/client just for types

Wrong:

```ts
import type { AbstractAgent, HttpAgent } from "@ag-ui/client";
```

Correct:

```ts
import type { AbstractAgent, HttpAgent } from "@copilotkit/react-core/v2";
```

Types are re-exported from `@copilotkit/react-core/v2` — no extra
dependency needed.

Source: packages/react-core/src/v2/index.ts:9

## References

- [Rename table (full 17+ rows)](references/rename-table.md)
- [Migration playbook (agent-executable recipe)](references/migration-playbook.md)
