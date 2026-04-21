# v1 → v2 Migration Playbook

Step-by-step recipe an AI coding agent can follow autonomously. Phases run
in order; each phase has a verification step before moving to the next.

## Phase 0 — Prep

1. Commit or stash any uncommitted work.
2. Create a migration branch: `git checkout -b migrate-copilotkit-v2`.
3. Pin v2 package versions in `package.json`:

```json
{
  "dependencies": {
    "@copilotkit/react-core": "^1.56.2",
    "@copilotkit/runtime": "^1.56.2"
  }
}
```

4. Remove `@copilotkit/react-ui` from `dependencies` if present — v2 chat
   components moved to `@copilotkit/react-core/v2`. If you still need the
   CSS, keep the stylesheet package or re-add later.

## Phase 1 — Audit (grep v1 imports)

Run every scan below and collect all hits into a worklist. Do NOT
modify yet.

```bash
# v1 provider + hooks from root:
grep -rnE "from ['\"]@copilotkit/react-core['\"]" src/
grep -rnE "\bCopilotKit[^P]" src/
grep -rnE "useCopilotAction|useCopilotReadable|useCoAgent|useCopilotChatSuggestions" src/

# react-ui chat components:
grep -rnE "from ['\"]@copilotkit/react-ui['\"]" src/
grep -rn "@copilotkit/react-ui/styles.css" src/

# runtime endpoints:
grep -rnE "copilotRuntime(NextJSAppRouter|NodeHttp|NodeExpress|Hono|ServiceAdapter)Endpoint" src/ server/
grep -rnE "OpenAIAdapter|AnthropicAdapter|GroqAdapter|LangChainAdapter" src/ server/

# props that renamed / deprecate:
grep -rn "publicApiKey" src/
grep -rn "imageUploadsEnabled" src/
grep -rn "agents__unsafe_dev_only\|selfManagedAgents" src/

# error-code equality (v1 SCREAMING_SNAKE):
grep -rnE "['\"](API_NOT_FOUND|AGENT_NOT_FOUND|NETWORK_ERROR|AUTHENTICATION_ERROR|MISUSE|UNKNOWN|VERSION_MISMATCH|CONFIGURATION_ERROR|MISSING_PUBLIC_API_KEY_ERROR|UPGRADE_REQUIRED_ERROR|NOT_FOUND|REMOTE_ENDPOINT_NOT_FOUND)['\"]" src/

# @copilotkitnext scope hallucinations (should ONLY appear in Angular code):
grep -rnE "@copilotkitnext/(react-core|runtime|react-ui)" src/ && echo "FAIL — @copilotkitnext/ scope only applies to Angular"
```

Verification: you have a worklist of every file that needs changes.

## Phase 2 — Mechanical renames (safe find/replace)

These are 1:1 renames with no semantic drift. Safe to apply without
reading the surrounding code.

### 2a — Import paths

```bash
# react-core root → /v2
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 sed -i 's#from "@copilotkit/react-core"#from "@copilotkit/react-core/v2"#g'

# react-ui component imports → react-core/v2
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 sed -i 's#from "@copilotkit/react-ui"#from "@copilotkit/react-core/v2"#g'

# stylesheet import
find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print0 | \
  xargs -0 sed -i 's#@copilotkit/react-ui/styles.css#@copilotkit/react-core/v2/styles.css#g'

# runtime → /v2
find . -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 sed -i 's#from "@copilotkit/runtime"#from "@copilotkit/runtime/v2"#g'
```

### 2b — Provider + hook renames (safe 1:1)

```bash
# Provider component
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 sed -i \
  -e 's#\bCopilotKit\b#CopilotKitProvider#g'

# Hooks with no semantic change
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 sed -i \
  -e 's#\buseCopilotReadable\b#useAgentContext#g' \
  -e 's#\buseCoAgent\b#useAgent#g'

# Props
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 sed -i \
  -e 's#\bpublicApiKey\b#publicLicenseKey#g'
```

WARNING: The `CopilotKit` rename is case-sensitive. It WILL rename
`CopilotKit` in any identifier (e.g. a local variable named
`myCopilotKit`) — review the diff.

### 2c — Attachments prop

Replace manually — the shape changes:

```tsx
// before
<CopilotChat imageUploadsEnabled />

// after
<CopilotChat attachments={{ enabled: true }} />
```

Verification: `pnpm build` compiles; any remaining errors are in the
judgment-required phases below.

## Phase 3 — Judgment splits (requires reading each call site)

### 3a — useCopilotAction → useFrontendTool vs useHumanInTheLoop

For every `useCopilotAction` call:

- If it has `handler` and no `render` → rewrite as `useFrontendTool`.
- If it has `render` and no `handler` → rewrite as `useHumanInTheLoop`
  (the render must call `respond(...)` to resolve the tool — a Promise
  is waiting server-side).
- If it has BOTH `handler` and `render` → split into two hooks with
  the same `name` and matching `parameters`. The tool's data path goes
  into `useFrontendTool`, the UI path goes into `useHumanInTheLoop`.

Rewrite the `parameters` array into a zod schema:

```tsx
// v1
parameters: [
  { name: "to", type: "string", required: true },
  { name: "body", type: "string" },
];

// v2
import { z } from "zod";
parameters: z.object({
  to: z.string(),
  body: z.string().optional(),
});
```

### 3b — useCoAgent → useAgent return shape

Every former `useCoAgent` call site now reads state differently:

```tsx
// v1
const { state, setState, running } = useCoAgent({ name: "research" });

// v2
const { agent, isRunning } = useAgent({ agentId: "research" });
const state = agent.state;
agent.setState({ ...state, foo: "bar" });
```

### 3c — Error-code equality rewrite

For every string-literal equality against a v1 error code:

```ts
// v1
if (err.code === "API_NOT_FOUND") {
  /* ... */
}

// v2 mapping (most common):
// API_NOT_FOUND / NOT_FOUND → runtime_info_fetch_failed
// AGENT_NOT_FOUND → agent_not_found
// NETWORK_ERROR → runtime_info_fetch_failed (most network errors surface here)
// AUTHENTICATION_ERROR → (no direct v2 equivalent — handle via HTTP 401 in onError context)

onError: ({ code }) => {
  if (code === "runtime_info_fetch_failed") {
    /* ... */
  }
  if (code === "agent_not_found") {
    /* ... */
  }
  if (code === "agent_thread_locked") {
    /* ... */
  }
};
```

Full v2 code catalog in `copilotkit/debug-and-troubleshoot` +
`references/error-codes.md` of that skill.

## Phase 4 — Runtime endpoint port

Locate the v1 runtime endpoint file. Replace the adapter-specific endpoint
helper with `createCopilotRuntimeHandler`.

### Next.js App Router example

```ts
// v1 — app/api/copilotkit/route.ts
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
const runtime = new CopilotRuntime({ actions: [...] });
const serviceAdapter = new OpenAIAdapter({ model: "gpt-4o" });
export const POST = async (req: Request) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime, serviceAdapter, endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};

// v2 — app/api/copilotkit/[...slug]/route.ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
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
    }),
  },
});
const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });
export const GET = handler;
export const POST = handler;
```

### React Router v7 example

Canonical for v2; see `copilotkit/0-to-working-chat`.

### Express / Hono

Avoid. Switch to the fetch handler mounted in your framework's native
route, or — if you truly need a standalone node server —
`createCopilotNodeHandler(createCopilotRuntimeHandler({...}))`.

## Phase 5 — Verification checklist

Run in order. Stop and fix at the first failure.

1. **Build passes.** `pnpm build` (or `nx affected -t build`).
2. **`/info` reachable.** Start the dev server; `curl http://localhost:3000/api/copilotkit/info` returns a JSON payload listing your agents.
3. **Chat loads.** Navigate to the app; `<CopilotChat>` renders without the red Dev Console banner.
4. **One agent run end-to-end.** Send a test message; the agent responds; no console errors; no `agent_not_found` or `runtime_info_fetch_failed`.
5. **Tool fires.** Prompt the agent to call a `useFrontendTool`; handler executes; result returns.
6. **HITL resolves.** If any `useHumanInTheLoop` exists, trigger it; the render renders in `status === "executing"`; clicking the button calls `respond(...)`; the agent resumes.
7. **Error-code branches fire.** Trigger a known error (e.g. wrong `runtimeUrl`); `onError` receives a snake_case `code`.
8. **Attachments work.** If the app uses attachments, verify drag-and-drop uploads.
9. **No `@copilotkitnext/` import in non-Angular code.** Final grep:
   `grep -rn "@copilotkitnext/" src/ server/` — only permitted in Angular projects.
10. **No `agents__unsafe_dev_only` / `selfManagedAgents` in production bundle.** Grep the shipped JS bundle.

## Phase 6 — Cleanup

1. Remove `@copilotkit/react-ui` from `package.json` if no longer imported.
2. Remove any service-adapter dependencies (`openai`, `@anthropic-ai/sdk`, etc.) that are now transitively owned by the agent factory's adapter choice.
3. Squash the migration branch, open a PR, run the production checklist
   (`copilotkit/go-to-production`) before merging.

## Failure Recovery

If a phase fails catastrophically (app won't boot, chat won't render),
roll back to the last green commit and re-run Phase 1 to re-scope. The
most common catastrophic failure modes:

- Mixed v1/v2 imports (`CopilotKit` from root + `CopilotKitProvider`
  from `/v2` in the same tree). The `/v2` subpath is a separate
  implementation — they do NOT compose.
- Missed stylesheet import — chat renders unstyled but functions.
- Missing `key={agentId}` on a multi-agent `<CopilotChat>` after the
  v2 return-shape change exposes state leaks.
