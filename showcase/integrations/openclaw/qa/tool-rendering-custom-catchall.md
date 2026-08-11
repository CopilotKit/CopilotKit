# QA: Tool Rendering — Custom Catch-all (OpenClaw)

Demo source: `src/app/demos/tool-rendering-custom-catchall/page.tsx`
Route: `/demos/tool-rendering-custom-catchall` · Agent: `tool-rendering-custom-catchall`
Run against the real backend at `http://localhost:3119/demos/tool-rendering-custom-catchall`.

Status: **partial / known gap** on OpenClaw. The custom wildcard renderer is
correctly wired, but this demo forwards **no executable tools** to the gateway,
so against the real backend there is nothing for the model to call and the card
does not paint. Read the caveat before running.

## What it exercises

The middle of the three-way tool-rendering progression (default catch-all →
custom catch-all → per-tool + catch-all). The page opts out of CopilotKit's
built-in tool-call UI and registers a **single** custom wildcard renderer via
`useDefaultRenderTool({ render })`. Every tool call — regardless of tool name —
is meant to paint through one branded ShadCN `CustomCatchallRenderer` card:

- Card root `data-testid="custom-wildcard-card"`, carrying `data-tool-name`
  (the tool name) and `data-status`.
- Header: monospaced tool name (`data-testid="custom-wildcard-tool-name"`), a
  `tool call` label, and a status badge (`data-testid="custom-wildcard-status"`).
- Badge transitions through `streaming` (amber, status `inProgress`) → `running`
  (neutral, status `executing`) → `done` (emerald, status `complete`).
- An **Arguments** `<pre>` (`data-testid="custom-wildcard-args"`) with
  pretty-printed JSON of the parameters.
- A **Result** section (`data-testid="custom-wildcard-result"`) showing
  "waiting for tool to finish…" until `status === "complete"`, then a
  green-tinted `<pre>` of the (JSON-parsed) result.

## The gap (why it doesn't work end-to-end on OpenClaw)

`useDefaultRenderTool` is **render-only** — it supplies UI for a tool call, not
the tool itself. In the LangGraph/claude-sdk reference this demo was ported
from, the mock tools (`get_weather`, `search_flights`, `get_stock_price`,
`roll_dice`) lived in the **backend**, so the model could call them and the
wildcard card rendered the result.

OpenClaw is a single stateless gateway with **no per-demo backend**. For a tool
to reach the model here it must be **frontend-forwarded** with `useFrontendTool`
(schema + handler), the way `frontend-tools` and `headless-complete` do it. This
demo's page registers **only** `useDefaultRenderTool` and defines no
`useFrontendTool` — so no tool schema and no handler are forwarded to the
gateway. The model has nothing to call, no `TOOL_CALL_*` events are emitted, and
the branded wildcard card never mounts.

Note: PARITY_NOTES lists tool-rendering catch-all under "Supported / demo tools
are frontend-forwarded," but that is the intended state, not the current page —
the catch-all variants were ported verbatim and their tool defs were not
adapted. Treat this as a known gap, not a supported demo.

## Manual steps

1. Open the demo. Confirm the `CopilotChat` renders in a centered, full-height
   layout (max-width 4xl, `rounded-2xl`) and the suggestion chips appear:
   **Weather in SF**, **Find flights**, **Roll a d20**, **Chain tools**.
2. Send a plain message (e.g. "Hi"). Confirm the agent replies with text — basic
   chat through the gateway is healthy.
3. Click **Weather in SF** (or ask "What's the weather in San Francisco?").
4. Expect (current reality): the agent answers in **text only**. No
   `custom-wildcard-card` appears, because no `get_weather` tool was forwarded
   for the model to call.

## Assertion bar

- Basic chat works (text response from the gateway).
- Honest gap check: **no** `data-testid="custom-wildcard-card"` renders on any
  tool-style prompt, confirming the missing-tool gap above rather than a
  renderer bug.

If/when the demo is fixed by adding `useFrontendTool` defs (mirroring
`headless-complete`), the expected behaviour becomes: every prompt that triggers
a tool paints exactly one `custom-wildcard-card` per call, with a distinct
`data-tool-name` but identical styling, and the badge progressing
`streaming` → `running` → `done`.

## Caveats

- Do not report the absent card as a rendering bug — the renderer is correct;
  the demo simply forwards no tools to the stateless gateway.
- The sibling **tool-rendering-default-catchall** shares the same gap (also
  render-only, no `useFrontendTool`). The base **tool-rendering** demo does
  define the tools, so use that page to see the branded/per-tool cards actually
  paint.
