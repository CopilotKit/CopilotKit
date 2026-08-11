# QA: Reasoning (Default) — OpenClaw

Demo source: `src/app/demos/reasoning-default/page.tsx`
Route: `/demos/reasoning-default` · Agent: `reasoning-default`
Runtime: `/api/copilotkit-reasoning`
Run against the real backend at `http://localhost:3119/demos/reasoning-default`.

Status: **supported** (see `PARITY_NOTES.md`). Reasoning emission is verified
end-to-end at the gateway level; this default variant renders it with zero
frontend configuration.

## What it exercises

A plain `<CopilotChat>` with **no slot override** — reasoning messages are drawn
by CopilotKit's built-in `CopilotChatReasoningMessage` component (the
"Thinking… / Thought for X" header with an expandable content region). This
demo pairs with `reasoning-custom`; the only difference is that the custom
variant overrides `messageView.reasoningMessage`. Here the built-in styling is
used as-is.

OpenClaw is a single stateless gateway with no per-demo backend, so there is no
graph logic behind this demo. The reasoning route (`/api/copilotkit-reasoning`)
is a pass-through to the gateway; the ag-ui adapter emits `REASONING_*`
(reasoning stream mode) for reasoning-capable models, and CopilotKit renders
those tokens in the built-in panel. There is nothing demo-specific on the
backend — behaviour comes entirely from the model producing a reasoning summary
plus the frontend's default rendering.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy and the configured model is reasoning-capable (reasoning
  stream mode is on — see `gateway/setup.sh`).

## Manual steps

1. Open the demo. Confirm the chat renders centered in the page (no sidebar —
   this uses `<CopilotChat>`, not `CopilotSidebar`).
2. Click the **Show reasoning** suggestion chip, or ask a concrete
   reasoning-eliciting question such as: **"Explain step by step why the sky
   appears blue during the day but red at sunset."**
3. Expect: before/alongside the answer, a **reasoning card** appears with a
   "Thinking…" (then "Thought for X") header. It renders via the built-in
   `CopilotChatReasoningMessage` — collapsible, default styling.
4. Expand the reasoning card and confirm it contains the model's streamed
   reasoning summary tokens (not the final answer).
5. Confirm the final answer streams in below/after the reasoning and reads
   coherently.

## Assertion bar

- The reasoning card is the **default** `CopilotChatReasoningMessage` — no
  custom `ReasoningBlock` or bespoke container (contrast with
  `reasoning-custom`).
- Reasoning tokens actually populate the card (it is not an empty shell).
- Exactly one reasoning card per turn; the final answer is separate from the
  reasoning content.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying a
reasoning-eliciting user message to the gateway operator route
(`http://127.0.0.1:8000/v1/ag-ui/operator`, Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE stream contains
`REASONING_MESSAGE_START` → `REASONING_MESSAGE_CONTENT` (deltas) →
`REASONING_MESSAGE_END`, followed by the normal text message and
`RUN_FINISHED`.

## Caveats

- Reasoning summaries only stream for a **real problem**. Meta-prompts like
  "show your reasoning" produce no reasoning summary, so the card will not light
  up — use a concrete question (the shipped suggestion is chosen for this
  reason).
- Reasoning content is a model-produced summary, not a verbatim chain of
  thought; exact wording varies run to run.
- `tool-rendering-reasoning-chain` (reasoning co-emitted with a tool call) is a
  known gap — it needs additional ag-ui support and is not covered here. This
  default variant is text-only reasoning.
