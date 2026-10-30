# Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[generativeUI] Component "Card" is defined more than once` at load | Your component has a `standardUI` name | Use the standard one, `overrides: { Card: { component } }`, or `standardUI.omit(["Card"])` |
| `[generativeUI] Event "onAction" ... matches no function, so it needs "parameters"` | Event declared without `parameters` | Give it a schema (`z.object({}).passthrough()` when the binding supplies the context) |
| `"accessibility" is reserved by A2UI` | A prop named `id`, `component`, `catalogId`, `accessibility` or `metadata` | Rename the prop |
| "Couldn't display this part: ..." on one component | Resolved props fail your Zod schema (`level: 2` for an enum, `"4"` for a number) | Server-side repair pass (templates/repair.ts); loosen the definition |
| "Part of this UI couldn't be shown" under the card | The browser rejected operations; `rejected` holds the reasons (`unknown prop "title"`, `missing required prop "text"`, `unknown component`) | Read them in `generativeUISurface`'s `rejected` prop or the activity content; alias and drop props in repair, run `validateOperation` server side |
| Rejected: `bind data with {"@path": "/x"}, not {"path": "/x"}` | Model (or old template) wrote a v0.9 binding | Upgrade bindings in repair; fix the prompt and templates |
| Rejected: `surface "x" already exists` / `was used before` | A second `createSurface` for an id | Append to the existing activity (`SurfaceStream.reopen()`, `upsert`, `data`); new surfaces need new ids |
| Rejected: `... a data prop can call only @index and the built-in functions` | An app function in a data prop | App functions belong in `{ functionCall }` event bindings; data props use `formatCurrency`, `formatDate`, ... |
| "Couldn't display this part: links: ..." on a SankeyChart | Array wrapped in an object, or union error hidden in `unionErrors` | Unwrap-array repair; flatten union errors |
| Surface stays empty or frames never fill | No component with id `"root"`, or a child id was never written (missing children render nothing) | Prompt "one root with id root"; prune dangling child ids after the stream |
| Bound inputs render empty while streaming | `data` is written last; bound values are empty until then | Inline literals in components; only inputs and templates bind |
| Input edits are lost / not sent with the action | Input not `writable`, value was a literal, or the event context does not reference the path | `writable: ["value"]`, bind `value` to `{ "@path" }`, seed data, reference the same paths in `event.context` |
| The agent cannot reset a form field | The user wrote that path; the agent can no longer change it | Use a new path or a new surface |
| A click does nothing | Event arrived while the agent was running (`agent_busy`), or the component never calls its event prop | Disable surface buttons while running; call `props.action?.()` |
| First paint only arrives when everything is done | The surface arrives as one operation | Append one `updateComponents` per component yourself |
| `/api/copilotkit/info` 404 | Single-file route with the v2 client | `app/api/copilotkit/[[...slug]]/route.ts` + `createCopilotRuntimeHandler({ basePath })` |
| No surfaces at all, plain tool results | No `generativeUI` on the provider (no envelope), or the activity type is not `generative-ui-surface` | `generativeUI={{ ui }}`; emit `GENERATIVE_UI_ACTIVITY_TYPE` activities |
| Two render paths compete (`render_ui` and your own tools) | Runtime middleware still on while the agent writes its own surfaces | `CopilotRuntime({ generativeUI: false })` |
| Agent says "no generative UI catalog" | The run carried no envelope: page outside the provider, or `agentIds` excludes this agent | Render the chat inside `<CopilotKitProvider generativeUI={{ ui }}>` |
| Buttons/inputs in the chat look off-theme (white primary) | `[data-copilotkit]` redefines shadcn tokens | Re-declare tokens on the surface wrapper; `theme` for standard components |
| Light error boxes in dark mode | Default per-component fallback uses inline light CSS | `generativeUI={{ ui, errorBoundary: { fallback } }}` |
| Layout breaks inside cards | Viewport breakpoints in renderers | Container queries, `auto-fit` grids |
| Build log has no rect for a component | Gen UI 2.0 passes no id; standard components have no `.a2-node` wrapper | Recover ids by render order (templates/node-rects.ts); measure standard components through their parent |
| Map: "Worker failed to load" (Turbopack) | MapLibre cannot locate its worker chunk | `setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href)` |
| Map pins cluster in the wrong area, or a pin is the city itself | Composer guessed coordinates | Geocode markers by name server-side (templates/geo.ts); drop area results that enclose the other stops |
| Map zoomed on one pin | Model passed `zoom` with several markers | Ignore `zoom` when there are 2+ pins; refit on coordinate changes |
| A click on a surface adds a new card instead of updating it | Update written to a new surface id | Write to the clicked surface (`manifest.action.action.surfaceId`) under its existing activity message |
| Emoji or em dashes in generated copy | Model style drift | Strip server-side before emitting |
| Places search returns nothing for "coffee shops" | Nominatim free text matches names, not categories | Normalize to OSM categories (`cafe`, `restaurant`) and fall back to Photon |

## Debug loop

1. A preview page per component (here `/components/<name>`): render every definition's sample through `StaticSurface`. Zero "Couldn't display this part" and zero rejected operations before touching the agent.
2. Drive real prompts headless and read the timeline: tool picked, data ms, each streamed component, repairs, validation.
3. When the composer drifts the same way twice, fix the description or the composer prompt, then add the case to the repair tests.
