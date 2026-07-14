# QA: Declarative UI — Hashbrown (OpenClaw)

Demo source: `src/app/demos/declarative-hashbrown/page.tsx`
Route: `/demos/declarative-hashbrown` · Agent: `declarative-hashbrown-demo`
Runtime: `/api/copilotkit-declarative-hashbrown` (dedicated route)

## Status: KNOWN GAP — not reliably supported

Per `PARITY_NOTES.md`, `byoc-hashbrown / declarative-json-render` is a **known
gap**. This demo needs a rendering system prompt — the instruction telling the
model to emit the hashbrown `{ ui: [...] }` envelope — that the claude-sdk /
langgraph reference carried in its **backend graph**. OpenClaw is a stateless
pass-through gateway with no per-demo backend, so that instruction has to be
delivered to the model another way (frontend `instructions` or ag-ui gateway
prompt injection). **That is not yet wired.** Without it, the model streams
prose, not the JSON envelope, so nothing renders.

## What it exercises (when wired)

The frontend is the full claude-sdk demo. `hashbrown-renderer.tsx` registers a
catalog (MetricCard, PieChart, BarChart, DealCard, Markdown) via
`@hashbrownai/react`'s `useUiKit`, and renders each assistant message through
`useJsonParser` for progressive JSON→UI streaming. The `HashBrownRenderMessage`
slot overrides `CopilotChat`'s `assistantMessage`, so a coherent
`{ ui: [...] }` payload from the model would assemble into cards/charts as
tokens arrive. The gateway itself just relays tokens — the rendering is entirely
frontend — so the only missing piece is the envelope instruction reaching the
model.

## Manual steps

1. Open the demo. Confirm the header "Declarative UI: Hashbrown", the
   `@hashbrownai/react` description, the chat composer, and 3 suggestion pills
   ("Sales dashboard", "Revenue by category", "Expense trend").
2. Click the **"Sales dashboard"** pill (dispatches automatically via
   `useConfigureSuggestions`).
3. **Expected today (gap):** the model streams plain prose or malformed JSON;
   `useJsonParser` yields no value, so the assistant message renders **empty**
   (the slot returns `null` when `value` is falsy). No metric cards or charts
   appear. This is the known gap, not a regression.
4. **Expected once the envelope prompt is wired:** within ~45s at least one
   MetricCard and one chart (pie/bar) render progressively in the transcript.

## Assertion bar (once wired)

- Suggestion pills produce a hashbrown render within ~45s.
- Renders assemble progressively as JSON chunks arrive (partial UI before the
  full response completes).
- Multi-turn works — a follow-up render appears alongside prior renders without
  clearing them.
- No uncaught errors; no `HashBrownRenderMessage must be used within
HashBrownDashboard`.

## Caveats

- Charts model `data` as a **JSON-encoded string** (hashbrown's schema
  validator rejects array-typed example props); the wrappers parse it and render
  `null` on a mid-stream parse failure, so partial frames are silently skipped.
- Until the rendering instruction is delivered gateway-side, treat an empty
  assistant bubble as the expected gap outcome — do not file it as a demo bug.
