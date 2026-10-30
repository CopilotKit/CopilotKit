# Wiring: generative UI, provider, runtime, agent

Versions this was built on: `@copilotkit/react-core`, `@copilotkit/runtime`, `@copilotkit/shared` 1.83.0 (Gen UI 2.0, A2UI v1.0), `@ag-ui/client` 1.0.2, zod 3.25 (props schemas may be zod 3 or any Standard JSON Schema library: zod 4.2+, ArkType, Valibot), Next 16.4, React 19.3. No pnpm overrides are needed. Gen UI 2.0 is marked experimental in 1.83.

## Generative UI (templates/catalog.ts)

```ts
"use client";
import { createGenerativeUI, standardUI, type GenerativeUITheme } from "@copilotkit/react-core/v2/generative-ui";

export const playgroundUI = createGenerativeUI({
  id: "https://your-app.dev/catalogs/main/v1",   // surfaces pin to it; the agent's createSurface uses the same catalogId
  extends: [standardUI],
  components: { Stat: { component: StatNode, description, props, events?, writable? }, /* ... */ },
});
export const playgroundTheme: GenerativeUITheme = { "--a2ui-font-family": "...", dark: { "--a2ui-color-accent": "..." } };
```

Call it once at module level. It throws on a name defined twice, an event with no `parameters` that matches no function, or a `writable` key that is not a prop.

## Provider

```tsx
const GENERATIVE_UI: GenerativeUIConfig = { ui: playgroundUI, theme: playgroundTheme, transport: "tool" };

<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  generativeUI={GENERATIVE_UI}             // sends the catalog in forwardedProps.copilotkit.ui, renders generative-ui-surface activities
  properties={{ mode }}                    // arrives as forwardedProps on every run
  renderActivityMessages={[surfaceRenderer]} // optional: your wrapper runs before the built-in one
  enableInspector={false}
>
```

Keep the config object stable (module constant or `useMemo`). `transport: "tool"` (the default) means operations arrive as activities; `"markdown"` has the model write them in ` ```a2ui ` fences instead. Replace the card around each surface in the chat with `<CopilotChat generativeUISurface={SurfaceCard} />`, a component that takes `{ surfaceId, isStreaming, error, rejected, children }`.

`surfaceRenderer` (templates/surface-mirror.tsx) sits in front of CopilotKit's own surface renderer, found with `copilotkit.renderActivityMessages.find((r) => r.activityType === GENERATIVE_UI_ACTIVITY_TYPE && r !== surfaceRenderer)`, so the chat keeps CopilotKit's validation, bindings and events, and every operation list is also copied to your store (for a side canvas, a JSON view, timings).

To render the same operations outside the chat (catalog previews, replays), use `StaticSurface` (templates/static-surface.tsx). It feeds CopilotKit's surface renderer a `generative-ui-surface` content object in its own thread, under a `StaticGenUIProvider` (a `CopilotKitProvider` with `generativeUI` and a no-op agent via `agents__unsafe_dev_only`) mounted once in the root layout.

## Runtime route (catch-all, or the v2 client's `/info` 404s)

```ts
// app/api/copilotkit/[[...slug]]/route.ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: { default: createPlaygroundAgent() },
  generativeUI: false, // the agent writes its own surfaces: no render_ui injection
});
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
export const GET = handler;
export const POST = handler;
```

`generativeUI` on the runtime controls `GenerativeUIMiddleware` (the `render_ui` tool): omitted, it applies to runs whose envelope uses the tool transport; `true` applies it to every run; `{ agents }` to the named agents; `false` never. The browser's envelope reaches the agent either way.

## Agent: BuiltInAgent custom factory (no second server)

```ts
import { BuiltInAgent } from "@copilotkit/runtime/v2";

export function createPlaygroundAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: ({ input, abortSignal }) => {
      const q = new EventQueue(); // templates/events.ts: async-iterable AG-UI events
      run(input, abortSignal, q).finally(() => q.close());
      return q;
    },
  });
}
```

The factory yields AG-UI events; `BuiltInAgent` emits `RUN_STARTED`/`RUN_FINISHED`. Inside `run`:

- Read the catalog: `const manifest = envelopeToManifest(readCopilotKitUIEnvelope(input.forwardedProps)!)` (both from `@copilotkit/shared`) gives `catalogId`, `components` (JSON Schema per component), `functions`, `surfaces` and the `action` of a click.
- Stream the router (`TEXT_MESSAGE_*`, `TOOL_CALL_START/ARGS/END`), execute tools, push `TOOL_CALL_RESULT`s.
- Write surfaces as `generative-ui-surface` activities (templates/surface.ts): one activity message per surface, id `generativeUISurfaceMessageId(surfaceId)`; an `ACTIVITY_SNAPSHOT` creates it with content `{ surfaceId, target: "chat", catalogId, operations: [createSurface], status: "streaming", rejected: [] }`, then `ACTIVITY_DELTA` JSON patches append to `/operations/-` and set `/status` to `"ready"`. `createSurfaceWriter(emit).openSurface({ target, surfaceId, catalog })` from `@copilotkit/runtime/v2` emits the same events (experimental; `setRoot`, `upsert`, `updateData`, `close`).
- `CUSTOM` events (`{ name: "a2ui.pipeline", value: { stage, t } }`) are a cheap way to expose timings to the UI; subscribe with `agent.subscribe({ onEvent })` from `useAgent`.

Any other AG-UI agent (LangGraph, Python) works the same way: emit those activity events itself, or leave `generativeUI` on and let the middleware give it `render_ui`.

## Chat input vs your own buttons

Prompt chips can send through the same agent: `agent.addMessage({ id, role: "user", content }); await copilotkit.runAgent({ agent, forwardedProps: { mode } })`. `forwardedProps` merge over the provider's properties, so the envelope still goes out. Surface clicks need no code: CopilotKit sends them.
