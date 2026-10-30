---
name: a2ui-catalog
description: Turns an app's existing React components into a CopilotKit Gen UI 2.0 generative UI (A2UI 1.0, `createGenerativeUI` on top of `standardUI`), with fixed-schema templates for common asks and a streaming dynamic-schema sub-agent for everything else. Use when the user wants the agent to answer with their own components, asks to "add A2UI", "build an A2UI catalog", "createGenerativeUI", "render_ui", "make the agent render our design system", "fixed vs dynamic schema", "generate_a2ui is slow", "migrate from A2UI v0.9", or to debug "Couldn't display this part" / rejected operations / surfaces that never paint. Don't use for open-ended HTML generation (Open Generative UI), for useComponent/useRenderTool controlled gen UI only, or for MCP Apps.
---

# A2UI catalog: from your React components to Gen UI 2.0 in CopilotKit

Built in `a2ui-playground` (123 components: CopilotKit's 69 standard ones plus 54 of the app's own; Next 16, CopilotKit 1.83 Gen UI 2.0, A2UI v1.0). Fixed surfaces paint in ~1.4 to 3 s, dynamic in ~3 s first paint with progressive streaming (measured on the v0.9 build of the same pipeline; re-measure after porting). Every step below links to a reference with the real code.

## Quick start (minimum path)

One custom component rendering in CopilotKit chat, with the runtime giving a stock agent the `render_ui` tool. The playground's `/minimal` page is this path (`src/app/minimal/page.tsx`, `src/app/api/minimal/[[...slug]]/route.ts`).

1. **Install**: `pnpm add @copilotkit/react-core @copilotkit/runtime @copilotkit/shared zod` (zod 3.25+, or zod 4.2+).
2. **Define the component** (React-free file). The schema describes the literal value only: the engine resolves `{ "@path" }` bindings and `{ "@call" }` functions at any depth before it validates.
   ```ts
   export const definitions = {
     Stat: {
       description: "One KPI: label, short value, optional delta like '+4%'.",
       props: z.object({
         label: z.string(),
         value: z.string(),
         delta: z.string().optional(),
       }),
     },
   };
   ```
3. **Render it and build the UI** (client file). Your component receives the resolved props directly:
   ```tsx
   import {
     createGenerativeUI,
     standardUI,
   } from "@copilotkit/react-core/v2/generative-ui";
   export const ui = createGenerativeUI({
     id: "https://example.dev/catalogs/main/v1",
     extends: [standardUI],
     components: {
       Stat: {
         ...definitions.Stat,
         component: ({ label, value, delta }) => (
           <div className="card">
             <span>{label}</span>
             <strong>{value}</strong>
             {delta}
           </div>
         ),
       },
     },
   });
   ```
4. **Pass it to the provider**: `<CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui }}><CopilotChat /></CopilotKitProvider>`. Every run then carries the catalog in `forwardedProps.copilotkit.ui` (the tool transport is the default).
5. **Serve a stock agent from a catch-all route** (`app/api/copilotkit/[[...slug]]/route.ts`):
   ```ts
   const runtime = new CopilotRuntime({
     agents: {
       default: new BuiltInAgent({
         model: "openai:gpt-5.5",
         prompt: "Answer with UI: call render_ui with A2UI v1.0 operations.",
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
   No runtime option is needed: a tool-transport envelope makes the runtime apply `GenerativeUIMiddleware`, which injects `render_ui`, validates each streamed operation against your catalog, and commits it as a `generative-ui-surface` activity that the chat paints.

That path has the primary model write the whole surface, and each operation paints when it closes. The workflow below adds what made the playground fast and robust: fixed templates, a dedicated streaming composer, server-side repair, geocoding, and in-place updates.

## Workflow

1. **Inventory components.** Run `scripts/scan-components.ts <componentsDir>` to draft Zod definitions from the TypeScript props. Keep components an agent would pick to _answer a question_ (cards, charts, tables, inputs). Check `standardUI` first: it already has layout, text, form, `Chart`, `Map`, `Table` and `List` (69 components), and a name can come from one place only. Drop internals (`DialogOverlay`, `SelectTrigger`). -> `references/definitions-and-descriptions.md`
2. **Write definitions.** One Zod object + one tight description per component, React-free so the server can import them. Props describe literal values. Child references are `child()` / `childList()`. Callbacks are `events` (`onAction`). Inputs declare `writable: ["value"]`. -> same reference
3. **Write renderers.** Display renderers read resolved props; children arrive rendered. Input renderers bind two-way: `useBound(props.value, props.setValue, fallback)`. The `onAction` event arrives as `action()`. Never throw on partial data. Use container queries, not viewport breakpoints. -> `references/renderers-and-data-binding.md`
4. **Create the generative UI.** `createGenerativeUI({ id, extends: [standardUI], components })` plus a `theme` for the standard components. Restyle a standard component with `overrides`, or drop it with `standardUI.omit([...])` and define your own. -> `references/wiring-and-runtime.md`
5. **Wire provider + runtime.** `<CopilotKitProvider generativeUI={{ ui, theme, transport: "tool" }}>` on the client; `app/api/copilotkit/[[...slug]]/route.ts` with `CopilotRuntime({ generativeUI: false })` when your agent writes its own surfaces. Catch-all route or `/info` 404s. -> `references/wiring-and-runtime.md`
6. **Fixed-schema surfaces + tools.** For each frequent ask: a constant component tree with `{ "@path" }` bindings and a tool that fetches data; the agent paints the tree as a skeleton at tool pick, then writes data and components to the same surface. -> `references/fixed-schema.md`
7. **Dynamic mode.** A `generate_a2ui` tool that runs a fast sub-agent with a forced tool call, parses the streamed args component by component, repairs each against the catalog the browser sent, and appends it to a `generative-ui-surface` activity. -> `references/dynamic-schema.md`
8. **Make the build visible.** Blueprint frames on id arrival (dynamic), the template skeleton at tool pick (fixed), measured rects for a build log. -> `references/streaming-visuals.md`
9. **Verify and tune.** Render every component's sample (no "Couldn't display this part"), drive real prompts headless, read the rejected operations, tune descriptions and the composer prompt from what the model actually emits. -> `references/performance.md`, `references/troubleshooting.md`

## Decision rules: fixed or dynamic

- **Fixed** when the ask is frequent and its shape is known (weather, a place list, an order, a signup form), when the UI must be designer-controlled, or when latency matters. The model only chooses the tool and supplies data. Paint time = router + data API.
- **Dynamic** for the long tail ("compare these", "plan a trip", "dashboard of X"), edits ("make it a bar chart"), and responses to surface actions.
- **Auto** (route to fixed when a `show_*` tool fits, else `generate_a2ui`) is the right default for chat. Give the router both tool sets and say so in one line of its prompt.
- If a fixed template needs a value the API cannot give (a name, a title), let the router pass it as a tool arg. Still fixed: no model writes the tree.

## Pitfalls (each one cost real time)

- **A name in both `standardUI` and `components`**: `createGenerativeUI` throws ("defined more than once"). Use the standard component, swap its React component with `overrides`, or `standardUI.omit(["Card"])` and define your own.
- **Invalid components never show**: the browser rejects an operation with an unknown component, an unknown or missing required prop, or an old-style `{"path"}` binding, and the card says "Part of this UI couldn't be shown". A prop of the wrong type fails your Zod schema at render: "Couldn't display this part: ...". Models send `level: 2` for an enum, `"4"` for numbers, `title` instead of `text`, `action` instead of `onAction`. Repair server side with the same validator before emitting (`templates/repair.ts`), and keep optional props optional.
- **First paint equals total time** when a surface arrives as one operation. Stream-parse the args and append one `updateComponents` per finished component (`templates/stream-parse.ts`, `templates/surface.ts`).
- **Ambiguous order breaks progressive paint**: tell the composer "root first, parents before children, write `components` before `data`, literals inline". A child id that has not arrived renders nothing, so emit Blueprint frames for referenced ids; order is what makes streaming look good.
- **A second `createSurface` for an existing id is rejected** (surface ids are unique for the life of the page). To change a card, append operations to its activity message (`SurfaceStream.reopen()`, then `upsert`/`data`).
- **The user owns what they typed**: once a writable input bound to `/form/email` writes it, the agent can no longer change that path. Seed form values before or with the components.
- **Gen UI 2.0 does not pass a component its id.** Wrap your components in `.a2-node[data-a2-type]` and recover ids by render order (`templates/node-rects.ts`).
- **CopilotKit's chat scope redefines shadcn tokens** (`[data-copilotkit]` sets `--primary` etc.). Re-declare your tokens on a wrapper around rendered surfaces; style standard components through `theme` (`--a2ui-*`).
- **The default per-component error box is light-mode inline CSS**: pass `errorBoundary.fallback` in the provider's `generativeUI` config.
- **Viewport breakpoints (`sm:`, `md:`) inside surfaces** misfire: surfaces live in ~600px chat bubbles and wide canvases. Use container queries and `auto-fit` grids.
- **Heavy JSON Schema in the prompt is slow**: serialize the catalog the browser sends to one-line signatures and leave out the standard components' styling props (`templates/catalog-prompt.ts`).
- **MapLibre under Turbopack** cannot find its worker: `setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href)`.

## Migrating from v0.9

`@copilotkit/a2ui-renderer`, `@ag-ui/a2ui-middleware` and `@ag-ui/a2ui-toolkit` are replaced by `@copilotkit/react-core/v2/generative-ui`, `@copilotkit/runtime/v2` and `@copilotkit/shared`. `createCatalog(..., { includeBasicCatalog })` becomes `createGenerativeUI({ extends: [standardUI] })`; `{ path }` becomes `{ "@path" }` and `dyn()` unions go away; `action` props become event props (`onClick`, `onAction`); `{ a2ui_operations }` tool results and `a2ui-surface` snapshots become `generative-ui-surface` activities with cumulative `operations`; the runtime's `a2ui` option becomes `generativeUI`. The basic-catalog names are now standard components with different props; a2ui-playground `src/a2ui/upgrade-v09.ts` maps them (Card title to a Title child, Text variants to Title/Caption, string gaps to numbers).

## Files in this skill

- `references/definitions-and-descriptions.md`, `renderers-and-data-binding.md`, `fixed-schema.md`, `dynamic-schema.md`, `streaming-visuals.md`, `wiring-and-runtime.md`, `performance.md`, `troubleshooting.md`
- `scripts/scan-components.ts`: TS compiler API scan -> draft definitions file
- `templates/` (client): `definitions-shared.ts` (child, childList, def, onAction, writableValue), `catalog.ts` (createGenerativeUI + theme), `renderer-types.ts`, `use-bound.ts`, `blueprint.tsx` (the stand-in frame), `surface-mirror.tsx`, `static-surface.tsx`, `node-rects.ts`
- `templates/` (agent): `surface.ts` (SurfaceStream: `generative-ui-surface` activities), `stream-parse.ts`, `repair.ts`, `catalog-prompt.ts`, `events.ts` (AG-UI event queue for custom factories), `geo.ts` (marker geocoding)
- `templates/reference/`: the working agent (`agent.ts`, `composer.ts`, `tools.ts`, `fixed-templates.ts`, `route.ts`, `use-send.ts`) to adapt
