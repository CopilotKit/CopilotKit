# QA: Agent Config Object (OpenClaw)

Demo source: `src/app/demos/agent-config/page.tsx`
Route: `/demos/agent-config` · Agent: `agent-config-demo` · Runtime: `/api/copilotkit-agent-config`
Backend: real OpenClaw gateway at `http://localhost:3119/demos/agent-config`

## What it exercises

Typed config knobs — **Tone** (professional / casual / enthusiastic),
**Expertise** (beginner / intermediate / expert), and **Response length**
(concise / detailed) — that steer the agent's replies without any per-demo
backend. The toggles live in `useAgentConfig`; each render the resolved config
is published to the agent via `useAgentContext`, so it rides along as an AG-UI
`context[]` entry on `RunAgentInput`. ag-ui injects context entries into the
model prompt every turn (the same path the readonly-state demo uses), so the
single stateless gateway adapts its behavior with no `configurable`/backend
plumbing to bridge.

## Prerequisites

- Stack running; demo reachable at `http://localhost:3119/demos/agent-config`.
- OpenClaw gateway healthy (ag-ui operator route + gateway token configured).

## Manual steps

1. **Initial state.** Open the demo. Confirm the "Agent Config" card renders
   above the chat with Tone = `professional`, Expertise = `intermediate`,
   Response length = `concise`, and the composer below it.
2. **Default send.** Send **"Tell me about black holes."** Expect a brief
   (1–3 sentence), professional, neutral reply — consistent with the defaults.
3. **Enthusiastic + detailed.** Set Tone = `enthusiastic` and Response length =
   `detailed`. Re-send the same question. Expect a noticeably longer, upbeat
   reply — the style difference vs. step 2 is clearly visible.
4. **Beginner vs expert.** Set Expertise = `beginner`, send **"What is quantum
   entanglement?"** — expect analogies and defined jargon. Switch to `expert`
   and re-send — expect precise terminology and no basics.
5. **Reactivity mid-thread.** Without reloading, change Tone to `casual` and send
   a follow-up. The new reply reflects the casual tone; earlier turns in the
   transcript stay unchanged (config applies per turn, not retroactively).

## Assertion bar

- Dropdown changes appear in the DOM immediately; the _next_ send reflects them.
- Style/length/expertise differences are clear side-by-side (qualitative but
  obvious). The model is being _steered_, so wording varies run to run.
- Transcript history is preserved when config changes mid-thread.
- No console errors during any step.

## Caveats

- This is prompt-level steering over a single stateless gateway, not a hard
  contract — expect qualitative, not deterministic, differences per send.
- The knobs affect only the **next** turn; they do not rewrite prior replies.
- Config travels as an AG-UI `context[]` entry (`useAgentContext`), not as
  shared state or a forwarded tool — there is no `STATE_SNAPSHOT` here.
