# QA: Tool Rendering — Default Catch-all (OpenClaw)

Demo source: `src/app/demos/tool-rendering-default-catchall/page.tsx`
Route: `/demos/tool-rendering-default-catchall` · Agent: `tool-rendering-default-catchall`
Run against the real backend at `http://localhost:3119/demos/tool-rendering-default-catchall`.

Status: **supported** (rendering path), with an OpenClaw-specific caveat about
where tool calls come from — see Caveats. The agent name maps to the same single
stateless OpenClaw gateway as every other demo (see `PARITY_NOTES.md`).

## What it exercises

The simplest point in the three-way tool-rendering progression. The frontend
calls `useDefaultRenderTool()` with **no config**, which registers CopilotKit's
package-provided `DefaultToolCallRenderer` as the `*` wildcard. The page adds
**zero** per-tool renderers and **zero** custom wildcard UI — so every tool call
that streams through must paint via that one built-in card (tool name, a live
status pill Running → Done, and a collapsible Arguments / Result section).

Without the hook the runtime would have no `*` renderer and tool calls would be
invisible (only the assistant's final text would show). This cell proves the
out-of-the-box card.

## OpenClaw reality (read this first)

Unlike the `frontend-tools` demo, this page defines **no tools** — it only
registers a renderer. The mock tools the page comment names (`get_weather`,
`search_flights`, `get_stock_price`, `roll_dice`) lived in the langgraph-python
reference **backend**. OpenClaw has no per-demo backend — it is a single
stateless gateway — and this demo does **not** frontend-forward those tools
(there is no `useFrontendTool` here). So the tools are only available if the
gateway model itself has equivalent tools registered.

The rendering path (wildcard `DefaultToolCallRenderer` paints whatever tool call
arrives) is what this cell is verifying, and that is what the manual steps
assert. Whether a _specific_ named tool fires depends on the gateway config, not
this demo.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the chat renders centered, full-height (`max-w-4xl`,
   `rounded-2xl`), and a basic message ("Hi") gets a text reply.
2. Confirm the four suggestion pills are visible: **Weather in SF**,
   **Find flights**, **Roll a d20**, **Chain tools**.
3. Click **Weather in SF** (or type "What's the weather in San Francisco?").
4. Expect: **if** the gateway model emits a tool call, a single built-in
   default tool-call card appears showing the tool name, a status pill that
   settles on **Done**, and expandable **Arguments** and **Result** sections.
   No custom-branded card (no `shadcn-catchall-card`, no per-tool card) appears.
5. Try **Find flights** and **Roll a d20**. Any tool call that streams paints
   via the **same** default card — identical header/pill/Arguments/Result
   layout, differing only in tool name and payload.
6. Click **Chain tools** (weather + flights + d20 in one turn). If the model
   chains calls, expect multiple default cards in succession, each visually
   indistinguishable apart from name/payload.

## Assertion bar

- Every tool call that appears paints via the built-in `DefaultToolCallRenderer`
  — tool name + live status pill + Arguments + Result.
- All tool calls use the **same** default card; zero visual variance beyond the
  payload; **no** custom-branded renderer anywhere.
- No console errors and no unhandled-promise warnings while a tool call streams.

## Caveats

- **No tools are defined by this demo.** If the gateway model has no matching
  tools, the assistant answers in **plain text** and **no** tool-call card
  renders — that is expected given OpenClaw's stateless pass-through gateway,
  not a bug in the renderer. To exercise the card end-to-end against OpenClaw,
  the equivalent tools must be present on the gateway model (or forwarded).
- A `_components/shadcn-catchall-renderer.tsx` file ships alongside the page but
  is **not imported** — the page deliberately uses the zero-config built-in
  card. Seeing a `shadcn-catchall-card` would mean the demo was wired wrong.
- This is a rendering cell: the mechanism under test is the wildcard renderer,
  not deterministic tool output. Payloads (temperature, flight list, dice roll)
  are whatever the model returns, not a fixed mock fixture.
