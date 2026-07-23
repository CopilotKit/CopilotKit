# QA: Reasoning — Custom (OpenClaw)

Demo source: `src/app/demos/reasoning-custom/page.tsx`
Route: `/demos/reasoning-custom` · Agent: `reasoning-custom`
Runtime: `/api/copilotkit-reasoning`
Run against the real backend at `http://localhost:3119/demos/reasoning-custom`.

Status: **supported** (see `PARITY_NOTES.md`). ag-ui emits `REASONING_*`
events in stream mode for reasoning-capable models; this demo swaps the panel
that renders them.

## What it exercises

The same reasoning stream as `reasoning-default`, but with the
`messageView.reasoningMessage` slot **overridden** by `ReasoningBlock` — a
tagged amber banner (`data-testid="reasoning-block"`) that surfaces the agent's
thinking chain inline instead of the built-in `CopilotChatReasoningMessage`.
Reasoning is a first-class message type (`message.role === "reasoning"`) in v2,
and the slot override is the public, stable way to customize its output.

`reasoning-default` and `reasoning-custom` share the same backend and runtime;
they differ **only** in whether the frontend overrides the reasoning slot. Use
the two side by side to confirm the override is what changes the rendering.

OpenClaw is a single stateless gateway with no per-demo backend. The reasoning
runtime is a pass-through: the gateway already emits `REASONING_MESSAGE_*` for
reasoning-capable models, so no per-demo graph is involved. The banner is a
pure-frontend concern driven by those relayed events.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy and configured for a **reasoning-capable model in stream
  mode** (per `gateway/setup.sh`) — otherwise no `REASONING_*` events arrive and
  the banner never lights up.

## Manual steps

1. Open the demo. Confirm the `CopilotChat` renders and a **Show reasoning**
   suggestion chip is offered.
2. Click **Show reasoning** (or type): _"Explain step by step why the sky
   appears blue during the day but red at sunset."_
3. Expect: while the run is active, a **Reasoning** banner appears with the
   label **"Thinking…"**, then fills with the agent's reasoning content (italic,
   pre-wrapped). After reasoning completes it reads **"Agent reasoning"**.
4. Confirm the final assistant answer streams in below the banner as normal
   chat text.
5. (Optional) Open `/demos/reasoning-default` with the same prompt and confirm
   the reasoning content is equivalent but rendered in the **default** panel —
   proving the only difference is the slot override.

## Assertion bar

- A `data-testid="reasoning-block"` element renders — the custom banner, not the
  default `CopilotChatReasoningMessage`.
- The banner shows **"Thinking…"** while streaming and **"Agent reasoning"**
  once content has landed.
- Reasoning content is non-empty and distinct from the final answer.

## Caveats

- **Use a concrete, multi-step question.** Reasoning models (e.g. gpt-5-mini)
  only emit reasoning-summary deltas when there's a real problem to reason
  about. A meta-prompt like "show your reasoning step by step" is read as a
  request to reveal chain-of-thought, is refused, and returns a plain reply with
  **no** reasoning summary — so the banner stays at "…" and never fills. The
  shipped suggestion is written to reliably trigger reasoning.
- Requires the gateway's reasoning stream mode; without a reasoning-capable
  model configured, this demo degrades to a plain chat reply with no banner.
- Behaviour comes from the frontend slot override + ag-ui's relayed
  `REASONING_*` events, not a per-demo backend graph.
