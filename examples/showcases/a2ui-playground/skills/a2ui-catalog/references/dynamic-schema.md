# Dynamic schema: a streaming composer sub-agent

For the long tail, a `generate_a2ui` tool hands the request to a fast second model that writes the whole surface. Three things make it good: a compact catalog prompt, progressive emission, and a repair pass.

## What CopilotKit gives you, and what it does not

- With the provider's tool transport and `generativeUI` left on, the runtime's `GenerativeUIMiddleware` adds a `render_ui` tool and its guide to the agent's run. The **primary** model then writes the surface itself as A2UI v1.0 operations (one model, long tool args). Each complete operation is validated against the catalog and committed at once.
- Paint granularity is the operation: a model that writes one `createSurface` holding every component paints when that operation closes, which is the end of the call.

So this build sets `generativeUI: false` and implements `generate_a2ui` itself inside a `BuiltInAgent` custom factory (templates/reference/agent.ts, composer.ts). Reusable pieces from `@copilotkit/shared`: `readCopilotKitUIEnvelope`, `envelopeToManifest`, `validateOperation`, `generativeUISurfaceMessageId`, `GENERATIVE_UI_ACTIVITY_TYPE`, `A2UI_VERSION`; from `@copilotkit/runtime/v2`: `createSurfaceWriter`.

## The composer call

```ts
const stream = await client.chat.completions.create({
  model: "gpt-5.4-mini",
  stream: true,
  reasoning_effort: "none",
  tool_choice: { type: "function", function: { name: "render_a2ui" } },
  tools: [RENDER_TOOL], // { components: object[], data?: object }; the agent picks the surface id
  messages: [
    { role: "system", content: systemPrompt(manifest) }, // built from the catalog the browser sent; identical every call -> prompt cache
    {
      role: "user",
      content: `${conversation}\n\nBuild this UI: ${brief}\n\nLive data: ${json}`,
    },
  ],
});
```

System prompt rules that changed output quality measurably:

- "Write args in this order: components, data." and "root first, then each parent before its children, in reading order. The UI paints as you write."
- "Put real values inline as literals. Use `{"@path"}` only for input values and inside templates." (inline literals paint immediately; bound values stay empty until `data` arrives at the very end)
- "Computed values use the functions: `{"@call":"formatCurrency","args":{...}}`." "Events: a Button's `onClick` and a card's `onAction` take `{"event":{"name","context"}}`."
- "Fully answer the request ... comparisons -> ComparisonTable, schedules -> Agenda or Timeline." Without it a pricing comparison came back as 7 bare Stat tiles.
- "Aim for 8 to 18 components: show each fact once." A 23-component Tokyo plan duplicated the same places in a map and a table and took 13.7 s.
- "Stat values are short numbers", "Percent values are 0-100", "Subtitles describe the content, never the UI", "Never say placeholder".

## Progressive emission (templates/stream-parse.ts, templates/surface.ts)

```ts
const surface = new SurfaceStream(q, `ui-${toolCallId.slice(-6)}`);
surface.create(); // empty surface, status "streaming"
const parser = new ComponentStreamParser();
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.arguments;
  if (!delta) continue;
  for (const c of parser.push(delta)) {
    // every component object that just closed
    const { component } = repairComponent(c, manifest);
    surface.upsert(component, ...pendingFramesFor(component)); // one updateComponents per finished component
  }
  if (parser.open)
    surface.upsert({
      id: parser.open.id,
      component: "Blueprint",
      of: parser.open.component,
    });
}
surface.data(data); // data before the final components: bindings resolve as they land
surface.upsert(...components);
surface.close(); // status "ready"
```

The parser is a string/escape-aware brace scanner over the `components` array; each closed object is `JSON.parse`d on its own, and `parser.open` exposes the id and type of the object still streaming. `updateComponents` upserts by id, so a frame and the component that replaces it are one entry. Keep a map of what you sent and only send a component again when it changed. A child id that has not arrived renders nothing, which is why the pending frames matter (streaming-visuals.md).

When the stream ends, return plain JSON as the `generate_a2ui` tool result (`{ surface: { surfaceId, components, data } }`) so the next run can find the surface.

The composer's own tool call stays inside your OpenAI request and never becomes an AG-UI tool call; only your activity events and the final `generate_a2ui` result reach the stream.

## Repair (templates/repair.ts)

Validate every streamed component and fix model drift before it reaches the client: your own components against their Zod schemas, standard components against the JSON Schema in the manifest, then every component through `validateOperation`, the same check the browser runs. A component that still fails is sent as a `Blueprint` with `state: "failed"` instead of an operation the browser would reject. Real cases from runs:

| Drift                                                | Fix                        |
| ---------------------------------------------------- | -------------------------- |
| `Heading { level: 2 }` (enum is `"1"/"2"/"3"`)       | number -> string           |
| `Heading { title: "..." }` (required `text` missing) | alias `title -> text`      |
| `{ y: "4" }`, `{ value: "$1,600" }`                  | numeric coercion           |
| `SankeyChart { links: { nodes, links } }`            | unwrap the array field     |
| `Stat { tone: "nope" }`                              | drop invalid optional prop |
| a standard component with a prop it does not have    | drop the prop              |
| `FlightCard { action: {...} }` (old habit)           | rename to `onAction`       |
| `{"path": "/x"}` (old binding)                       | `{"@path": "/x"}`          |
| a malformed row in `data`                            | drop that row              |

Union errors hide the real issue in `unionErrors`; descend into the most specific branch. Skip any value that is a `{"@path"}` or `{"@call"}`: the browser resolves it. At the end, prune child ids that no component defines. Surface the fixes in your timeline ("repaired title->text") so description tuning has evidence.

## Data before composing

Give the router `get_*` data tools (weather, places, routes, FX) in dynamic mode. Run them in parallel, then compose in the same run with the results in the composer prompt. If the router fetched data but did not call `generate_a2ui`, compose anyway instead of paying for a second router hop.

## Map pins: geocode by name (templates/geo.ts)

The composer picks the right places but guesses coordinates. In one Tokyo run every pin sat in Nakano and one stop was "Tokyo" itself. When a `MapView`, `PlaceList` or `LocationCard` streams in, geocode each marker by name while the rest of the surface keeps streaming:

- Search Nominatim bounded to a box (~45 km) around the model's own pins, raced against Photon (Nominatim's policy is 1 request/second, so its calls go through one paced queue and are skipped once Photon has answered). Cache results.
- Replace the guessed coordinates; recompute any distances shown from the new pins.
- Drop a stop that resolves to an area enclosing the other stops (the trip's city). Keep areas that do not (Shibuya ward in a Tokyo plan).
- Upsert the patched component when the lookup lands and include the patched props in the final components.
- Prompt: "markers are specific named places the plan mentions, never the city itself".
- Map renderers must fit bounds whenever the coordinates change, and ignore a model-supplied `zoom` when there are two or more pins.

## Edits and actions: update the same surface in place

A surface click arrives as a visible user message naming the action, plus the A2UI action in the envelope (`manifest.action.action` has `name`, `surfaceId`, `sourceComponentId`, `context`). Router rule: refinements (filter, sort, show more, change chart type) call `generate_a2ui { intent: "update", target_surface_id }`; submissions (signup, RSVP) create a new confirmation surface.

For an update:

```ts
const clicked = manifest?.action?.action.surfaceId;
const prior = findSurface(input.messages, target ?? clicked); // latest { surfaceId, components, data } from earlier tool results
const result = await compose({ ..., prior });                 // composer streams silently: no frames over the visible card
// inside compose, for an update:
surface.reopen();                                             // status back to "streaming", no rejections
surface.data(data);
surface.upsert(...components);
surface.close();
```

A surface has one activity message, `generativeUISurfaceMessageId(surfaceId)`, so appending to it changes the card in place. Never send `createSurface` again: the client rejects a surface id it has seen. The playground's `scripts/check-refine.mjs` drives "Nonstop only" on a flights surface and checks it stays one card.
