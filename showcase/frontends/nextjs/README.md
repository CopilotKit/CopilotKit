# Shared app

Change a demo here once, and the change reaches every integration. This Next.js app renders each showcase demo from one copy, for every integration, at `/demos/<integration>/<demo>`.

## Change a demo

1. Edit the demo in `src/app/demos/[integration]/<demo>/`. Follow the [demo code rules](#demo-code-rules).
2. If the page now behaves differently, update its spec: `tests/e2e/<demo>.spec.ts`. See [Writing a spec](../../TESTING.md#writing-a-spec).
3. Run the unit tests, in `showcase/frontends/nextjs`: `npm test`.
4. Rebuild the app and run the shared e2e suite for one integration that serves the demo, from the repo root: `pnpm nx run showcase-frontend-nextjs:e2e-local --build strands`. Before the first run, do the [setup in `TESTING.md`](../../TESTING.md#shared-e2e-suite).
5. If the fix must reach production now, also fix the integration's own copy. See [Production today](#production-today).

When the suite passes, open `http://localhost:3200/demos/strands/<demo>`. The page shows your change. To see the change on another integration, run the suite with its slug.

## Demo code rules

- Import only from the demo folder, `_shared`, `@/components`, `@/lib` and packages. Code that several demos use goes in `src/app/demos/[integration]/_shared/`.
- Pass `useDemoRuntimeUrl("<demo>")` as the `runtimeUrl`. Use the agent ids that `src/demo-agents.ts` lists for the demo.
- Never branch on the integration slug. If an integration really works differently, see [When one integration needs a difference](#when-one-integration-needs-a-difference).
- Keep the `@region[...]` and `@endregion[...]` markers. They mark the code snippets for the docs.
- In an A2UI catalog, import `z` from `_shared/a2ui-zod` (zod 3). The app's `zod` package is zod 4.

## When one integration needs a difference

A difference between integrations goes in their aimock fixtures (iron rule 4 in [`AGENTS.md`](../../AGENTS.md)). Only a real framework difference is per-integration data. For example:

- `gen-ui-interrupt`: how the agent pauses (an interrupt event or a frontend tool), and where the bridge puts the payload.
- `shared-state-streaming`: spring-ai shows a notice, because it cannot stream the document.
- `agent-config`: the Microsoft integrations read the config from the run's forwarded props.

To add such a difference:

1. Define a serializable config type in the demo folder, for example `config.ts`. If behavior differs, the config holds a key, and the demo folder holds the code for each key.
2. Add the integration's data: `src/integrations/<slug>/demos/<demo>.ts`.
3. Make `page.tsx` a server component. It reads the data with `loadIntegrationDemoConfig` and passes it to a client component as props.

```ts
// src/integrations/strands/demos/gen-ui-interrupt.ts
import type { GenUiInterruptConfig } from "@/app/demos/[integration]/gen-ui-interrupt/config";

export default {
  mechanism: "interrupt",
  payload: "strands-reason",
  answer: "selection",
} satisfies GenUiInterruptConfig;
```

```tsx
// src/app/demos/[integration]/gen-ui-interrupt/page.tsx
import { loadIntegrationDemoConfig } from "@/lib/demo-config";
import { DEFAULT_GEN_UI_INTERRUPT_CONFIG } from "./config";
import type { GenUiInterruptConfig } from "./config";
import { GenUiInterruptDemo } from "./gen-ui-interrupt-demo";

export default async function GenUiInterruptPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  const config = await loadIntegrationDemoConfig<GenUiInterruptConfig>(
    integration,
    "gen-ui-interrupt",
  );
  return (
    <GenUiInterruptDemo config={config ?? DEFAULT_GEN_UI_INTERRUPT_CONFIG} />
  );
}
```

When the integration has no file for the demo, `loadIntegrationDemoConfig` returns `undefined`, and the page uses its default. A spec reads the same data with `integrationDemoConfig("<demo>")` from `tests/e2e/helpers.ts`.

## Run the app

The app is a standalone npm project. Before `dev`, `build`, `typecheck`, `test` and `e2e`, a pre-script writes `src/data/` from the integration manifests. That pre-script needs the repo's pnpm dependencies, so run `pnpm install` at the repo root once.

In `showcase/frontends/nextjs`:

```sh
npm ci --legacy-peer-deps
OPENAI_API_KEY=<your key> npm run dev
```

Open `http://localhost:3000`. The page lists every integration and its demos. The demos of the in-process integrations, built-in-agent and mastra, work with this command. Their agents call the LLM themselves, with `OPENAI_API_KEY` and, if it is set, `OPENAI_BASE_URL`.

An HTTP integration also needs its address variables. `scripts/agent-env.ts` prints them for a host:

```sh
npx tsx scripts/agent-env.ts strands localhost
# AGENT_URL_STRANDS=http://localhost:8000
AGENT_URL_STRANDS=http://localhost:8000 npm run dev
```

The agent must listen at that address. If a variable is not set, the demo's runtime answers 404 `{ "error": "unconfigured" }`.

Nx targets, from the repo root. Each target except `docker-build` runs `npm ci` in the app first.

| Task                                 | Command                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| Unit tests (vitest)                  | `pnpm nx run showcase-frontend-nextjs:test`             |
| Typecheck                            | `pnpm nx run showcase-frontend-nextjs:typecheck`        |
| Production build                     | `pnpm nx run showcase-frontend-nextjs:build`            |
| Docker image                         | `pnpm nx run showcase-frontend-nextjs:docker-build`     |
| Shared e2e suite for one integration | `pnpm nx run showcase-frontend-nextjs:e2e-local <slug>` |

[`TESTING.md`](../../TESTING.md#shared-e2e-suite) has the first-run setup and more ways to run the suite.

## How a demo reaches its agent

1. The page calls `useDemoRuntimeUrl("agentic-chat")`. On `/demos/strands/agentic-chat`, that is `/api/strands/agentic-chat`.
2. The catch-all route, `src/app/api/[integration]/[demo]/[[...slug]]/route.ts`, loads `src/integrations/strands/agents.ts` and calls `createRuntimeConfig("agentic-chat")`.
3. The route builds a `CopilotRuntime` from those agents and the demo's entry in `DEMO_RUNTIME_OPTIONS` (`src/demo-runtime-options.ts`). Options that the integration returns replace that entry, key by key.
4. Each strands agent sends its requests to the address in `AGENT_URL_STRANDS`, plus a path.

The route answers 404 in these cases:

- No manifest has the integration: `{ "error": "unknown integration" }`.
- An address variable in the integration's `env.ts` is not set: `{ "error": "unconfigured", "missing": [...] }`.
- `createRuntimeConfig` returns `undefined` for the demo: `{ "error": "unknown demo" }`.

The auth and voice demos have their own routes. `/api/health` is the app's health check.

An integration serves the demos that its manifest routes (`route: /demos/<demo>`), plus the ids in `src/integrations/<slug>/extra-demos.json`. A page for any other demo is a 404. To add an integration, follow the [Shared App](../../INTEGRATION-CHECKLIST.md#shared-app) checklist.

## Production today

This app is not deployed yet. Its Railway service comes next.

- Each integration still has its own Next.js website in `showcase/integrations/<slug>/`, and that website serves production.
- Each integration moves to this app in its own later change.
- Until then, the harness probes, the shells and the docs-site code snippets read the integration websites and folders.

So a demo fix goes here. If the fix must reach production before the integration moves, also make it in `showcase/integrations/<slug>/src/app/demos/<demo>/`.
