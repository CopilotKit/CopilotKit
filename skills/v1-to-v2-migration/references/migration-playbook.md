# v1 → v2 Migration Playbook

Step-by-step recipe an AI coding agent can follow autonomously. Phases run
in order; each phase has a verification step before moving to the next.

## Phase 0 — Prep

1. Commit or stash any uncommitted work.
2. Create a migration branch: `git checkout -b migrate-copilotkit-v2`.
3. Pin v2 package versions in `package.json`. Use a tilde range during the
   migration to avoid accidental drift:

```json
{
  "dependencies": {
    "@copilotkit/react-core": "~1.56.2",
    "@copilotkit/runtime": "~1.56.2"
  }
}
```

After the migration is complete and validated end-to-end, widen the
range (e.g. `^1.56.2`) if you want automatic minor-version updates.

4. Remove `@copilotkit/react-ui` from `dependencies` if present — v2 chat
   components moved to `@copilotkit/react-core/v2`. If you still need the
   CSS, keep the stylesheet package or re-add later.

## Phase 1 — Audit (grep v1 imports)

Run every scan below and collect all hits into a worklist. Do NOT
modify yet.

```bash
# v1 provider + hooks from root:
grep -rnE "from ['\"]@copilotkit/react-core['\"]" src/
grep -rnE "\bCopilotKit\b" src/ | grep -vE "CopilotKit(Provider|CoreErrorCode|ErrorCode)"
grep -rnE "useCopilotAction|useCopilotReadable|useCoAgent|useCopilotChatSuggestions" src/

# react-ui chat components:
grep -rnE "from ['\"]@copilotkit/react-ui['\"]" src/
grep -rn "@copilotkit/react-ui/styles.css" src/

# runtime endpoints:
grep -rnE "copilotRuntime(NextJSAppRouter|NodeHttp|NodeExpress|Hono|ServiceAdapter)Endpoint" src/ server/
grep -rnE "OpenAIAdapter|AnthropicAdapter|GroqAdapter|LangChainAdapter" src/ server/

# props that renamed / deprecate:
#   publicApiKey: NOT deprecated — it's the canonical v2 name. No action
#   required. `publicLicenseKey` is accepted as an alias.
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

All replacements below use `perl -i -pe` instead of `sed -i` because
`sed -i` is not portable across BSD (macOS) and GNU (Linux) — BSD sed
requires `-i ''` and breaks on the GNU form. `perl -i -pe` works
identically everywhere. The scans are scoped to `src/` (frontend) and
`src/ app/ server/` (runtime endpoint) to avoid descending into
`node_modules/`.

```bash
# react-core root → /v2
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 perl -i -pe 's#from "\@copilotkit/react-core"#from "\@copilotkit/react-core/v2"#g'

# react-ui component imports → react-core/v2
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 perl -i -pe 's#from "\@copilotkit/react-ui"#from "\@copilotkit/react-core/v2"#g'

# stylesheet import
find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print0 | \
  xargs -0 perl -i -pe 's#\@copilotkit/react-ui/styles\.css#\@copilotkit/react-core/v2/styles.css#g'

# runtime → /v2 (scope to wherever your server code lives; NOT `.`)
find src app server -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null | \
  xargs -0 perl -i -pe 's#from "\@copilotkit/runtime"#from "\@copilotkit/runtime/v2"#g'
```

### 2b — Provider + prop renames (safe 1:1)

```bash
# Provider component
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 \
  perl -i -pe 's#\bCopilotKit\b#CopilotKitProvider#g'

# Readable-context hook rename (signature stays {description, value})
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 \
  perl -i -pe 's#\buseCopilotReadable\b#useAgentContext#g'
```

WARNING: The `CopilotKit` regex uses `\b` word boundaries, which
correctly avoids matching inside identifiers with adjacent word-class
characters (`CopilotKitProvider`, `CopilotKitCoreErrorCode`,
`CopilotKitErrorCode`, `useCopilotKit`, `myCopilotKit` all stay intact
because the next/previous character is a word-class letter). The
remaining edge cases to review manually:

- Bare `CopilotKit` appearing in comments or prose that refers to the
  product/library name — these should NOT become `CopilotKitProvider`.
- String literals containing the bare word `CopilotKit` (rare but
  possible in error messages / test fixtures).

Always review the diff after running.

> NOTE: `useCoAgent` → `useAgent` is deliberately NOT in this phase.
> The return shape changes (`{ state, setState, running }` → `{ agent }`
> with state on `agent.state`, `isRunning` on `agent.isRunning`), so a
> mechanical identifier rename leaves every destructure broken. See
> Phase 3b below.

> NOTE: `publicApiKey` → `publicLicenseKey` is ALSO deliberately NOT
> in this phase. As of v2, `publicApiKey` is the canonical supported
> name; `publicLicenseKey` is an accepted alias. Renaming canonical →
> alias is the wrong direction. Leave `publicApiKey` in place.

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

### 3b — useCoAgent → useAgent (rename + return-shape rewrite)

`useCoAgent` was deliberately excluded from the Phase 2b mechanical
sed because the return shape differs — a bare identifier rename leaves
every destructure broken. Rewrite each call site by hand:

```tsx
// v1
const { state, setState, running } = useCoAgent({ name: "research" });

// v2 — useAgent returns only { agent }; state/mutation/status live on
// the agent instance itself.
const { agent } = useAgent({ agentId: "research" });
const state = agent?.state;
const isRunning = agent?.isRunning;
agent?.setState({ ...agent.state, foo: "bar" });
```

Notes:

- `useAgent` returns `{ agent }`. `agent` may be `undefined` while the
  runtime is still loading — guard with optional chaining.
- There is no separate `setState`, `running`, or state selector on the
  hook's return value. Read/mutate via `agent.state` / `agent.isRunning`
  / `agent.setState(...)`.
- To trigger a run, use `copilotkit.runAgent({ agent })` from
  `useCopilotKit()`.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx` — the return
statement is `return { agent };` (no other fields).

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

// v2 — app/api/copilotkit/[[...slug]]/route.ts
//
// IMPORTANT: v2's createCopilotRuntimeHandler serves multiple sub-paths
// under `basePath` (e.g. /info, /agent/run, /agent/connect, /transcribe,
// /threads/*). If you keep the old single-file `app/api/copilotkit/route.ts`
// Next.js will only route the exact `/api/copilotkit` URL to your handler —
// every sub-path 404s. Move the file to an optional catch-all
// `[[...slug]]/route.ts` (or a non-optional `[...slug]/route.ts` if you
// don't need the bare basePath to hit this handler) so Next.js forwards
// the full path. Leaving the v1 single-route folder in place with v2
// handlers will break chat with `runtime_info_fetch_failed` at boot.
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
