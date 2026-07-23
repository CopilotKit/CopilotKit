# QA: Declarative JSON Render (OpenClaw)

Demo source: `src/app/demos/declarative-json-render/page.tsx`
Route: `/demos/declarative-json-render` · Runtime: `/api/copilotkit-declarative-json-render` · Agent: `byoc_json_render`

> **Status: KNOWN GAP — not yet wired on the gateway.** This demo depends on a
> rendering system prompt that instructs the model to emit a `@json-render/react`
> flat-spec JSON object (`{ root, elements }`). That prompt lived in the reference
> backend. OpenClaw is a stateless pass-through gateway and does not yet deliver
> that instruction to the model (via frontend `instructions` or gateway prompt
> injection). See `PARITY_NOTES.md` → "Known gaps". Until it is wired, expect the
> agent to reply with plain prose and the page to fall back to the default
> assistant bubble instead of rendering components. Run this doc as a smoke check,
> not a pass/fail acceptance gate.

## What it exercises

A "bring your own component" declarative-UI pattern. The frontend defines a
catalog of three React components — `MetricCard`, `BarChart`, `PieChart`
(`catalog.ts` / `registry.tsx`) — and swaps the chat's assistant message renderer
for `JsonRenderAssistantMessage` (`json-render-renderer.tsx`). That renderer
tries to parse the assistant's streamed text as a json-render spec; when it
parses, it hands the spec to `@json-render/react`'s `Renderer` and draws the
components. When it does not parse (plain prose, partial stream), it renders the
default assistant bubble. All rendering is frontend-only — the gateway just
relays whatever text the model produces.

## Manual steps

Run against the real backend at `http://localhost:3119/demos/declarative-json-render`.

1. Open the demo. Confirm the chat composer renders and three suggestion pills
   appear: **Sales dashboard**, **Revenue by category**, **Expense trend**.
   No console errors.
2. Click **Sales dashboard** (`"Show me the sales dashboard with metrics and a
revenue chart"`).
3. Click **Revenue by category** (`"Break down revenue by category as a pie chart"`).
4. Click **Expense trend** (`"Show me monthly expenses as a bar chart"`).
5. Free-form: type `"Show me a metric for quarterly revenue"` and send.

## Expected result

- **When the rendering prompt is wired:** within ~60s each suggestion produces an
  assistant message containing a `data-testid="json-render-root"` wrapper with the
  matching component(s) inside — a `data-testid="metric-card"` for a metric, a
  `data-testid="pie-chart"` (donut + legend) for a category breakdown, a
  `data-testid="bar-chart"` (labelled bars) for a trend. Once the spec parses, the
  raw JSON is replaced by the rendered components.
- **In the current (unwired) state:** the agent answers in plain text; the spec
  does not parse; the page shows the default assistant bubble. This is the
  expected behavior for the known gap — no crash, no stuck spinner. The renderer's
  `parseSpec` tolerates prose and code fences and simply falls through to the
  default bubble.

## Assertion bar

- No uncaught console errors and no stuck spinner in either state.
- The renderer never shows raw `{ root, elements }` JSON as text once a valid
  spec has streamed in (it swaps to components); malformed/prose output falls
  back cleanly to the default bubble.
- Only the three catalog types render — `MetricCard`, `BarChart`, `PieChart`
  (`ALLOWED_TYPES` in `json-render-renderer.tsx`); any other element type causes
  the whole spec to be rejected and fall back to prose.

## Caveats / notes

- **Rendering prompt not delivered** — the primary blocker; see the status banner
  above. This is the reason renders will not appear until the gateway prompt
  injection (or a frontend `instructions` string) is added.
- **Agent-id / route key mismatch** — the page mounts the agent as
  `byoc_json_render` (`chat.tsx`), but the runtime route registers the gateway
  agent under the key `declarative_json_render`
  (`api/copilotkit-declarative-json-render/route.ts`). Confirm these are
  reconciled before treating a non-render as purely a prompt problem — a mismatch
  would surface as the run never reaching the intended agent.
- **Frontend-only rendering** — unlike the A2UI demos there is no runtime tool
  call; the components are driven entirely by parsing the assistant's text, so
  render fidelity depends wholly on the model emitting well-formed spec JSON.
