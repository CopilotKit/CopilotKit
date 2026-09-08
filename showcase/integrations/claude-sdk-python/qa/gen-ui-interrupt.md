# QA: In-Chat HITL via useInterrupt — Claude Agent SDK (Python)

> **STATUS: QUARANTINED.** `gen-ui-interrupt` is listed under
> `not_supported_features` in `manifest.yaml` (alongside `interrupt-headless`),
> with this reason: turn-2 fails on a `useInterrupt` / `useHeadlessInterrupt`
> **resume-path** bug in `@copilotkit/react-core/v2` — the backend resumes and
> streams (HTTP 200) but the frontend never appends the confirmation assistant
> bubble, so the harness DOM settle-check times out. The fix is a
> published-package change. The reference integration (langgraph-python)
> quarantines the same cell for the same reason. The demo stays fully wired.
>
> Sections 1–2 below are verifiable today. Section 3 is the **re-qualification
> checklist**: do not tick it, and do not report the cell green off the back of
> it — run it only once the upstream react-core fix lands, and report the result
> to whoever owns the manifest.

## Prerequisites

- Demo is deployed and accessible at `/demos/gen-ui-interrupt` on the dashboard host
- Next.js host is healthy (`GET /api/health`) and the Python backend is reachable (`GET /api/copilotkit` reports `agent_status: "reachable"`); `ANTHROPIC_API_KEY` is set. `ANTHROPIC_MODEL` is optional (`.env.example` sets `claude-opus-4-8`, which is also the in-code fallback in `src/agents/interrupt_agent.py`)
- `AGENT_URL` (default `http://localhost:8000`) points at `src/agent_server.py`. This demo goes through the SHARED runtime `/api/copilotkit`: `dedicatedAgentPaths` in `src/app/api/copilotkit/route.ts` maps agent name `gen-ui-interrupt` → `${AGENT_URL}/interrupt-adapted` → `run_interrupt_agent`. There is **no** LangGraph deployment and no `interrupt()` primitive in this integration
- **How this integration adapts the demo.** The Claude Agent SDK has no LangGraph checkpoint/resume `interrupt()`. `src/agents/interrupt_agent.py` instead forwards the frontend tool definitions it receives in `input_data.tools` straight to Claude and, per its `SYSTEM_PROMPT` ("you MUST call the `schedule_meeting` tool" with a `topic` and optional `attendee`), emits a `schedule_meeting` tool call. Two facts to hold onto while testing, both verified in this integration's source:
  - the Python backend emits **no** AG-UI interrupt signal — no `on_interrupt` custom event and no `RUN_FINISHED` `outcome: "interrupt"` — anywhere in `src/agents/`
  - `src/app/demos/gen-ui-interrupt/page.tsx` registers **no** `useFrontendTool` / `useRenderTool`; it wires only `useInterrupt({ agentId: "gen-ui-interrupt", renderInChat: true, render })`
    So `useInterrupt`'s `render` callback has no event source here, and the picker card is expected NOT to mount. If it DOES mount, that is new information — record it and escalate, because it changes the quarantine rationale
- The picker component is `src/app/demos/gen-ui-interrupt/_components/time-picker-card.tsx` (testids `time-picker-card`, `time-picker-slot`, `time-picker-cancel`, `time-picker-picked`, `time-picker-cancelled`); fallback slot labels come from `src/app/demos/_shared/interrupt-fallback-slots.ts`

## Test Steps

### 1. Basic Functionality (verifiable today)

- [ ] Navigate to `/demos/gen-ui-interrupt`; verify the page renders within 3s with the `CopilotChat` centered in a `max-w-4xl` container filling full viewport height, `rounded-2xl`
- [ ] Verify the `CopilotChat` input placeholder is visible and the transcript is empty on first load
- [ ] Send "Hello" and verify the agent responds with a text-only reply (no picker — the prompt only instructs `schedule_meeting` for booking/scheduling requests)

### 2. Feature-Specific Checks (verifiable today)

#### Suggestions

- [ ] Verify both suggestion pills are visible with verbatim titles:
  - "Book a call with sales" (message: "Book an intro call with the sales team to discuss pricing.")
  - "Schedule a 1:1 with Alice" (message: "Schedule a 1:1 with Alice next week to review Q2 goals.")

#### Turn 1 — Backend tool call reaches the client

- [ ] Click "Book a call with sales"
- [ ] DevTools → Network: verify the request goes to `/api/copilotkit` and the SSE stream carries `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` for `schedule_meeting` with a `topic` (and `attendee` where the prompt names one) — this is the backend half of the adaptation and it should work
- [ ] Record whether a `data-testid="time-picker-card"` element mounts inside the chat transcript. Per the Prerequisites, the expected answer on this integration is **no** — the tool call arrives with no interrupt signal and no frontend handler, so the transcript shows the assistant text and however `CopilotChat` renders an unhandled tool call. Note down exactly what you see — that observation is the useful output of this step
- [ ] Verify the page does not crash: no uncaught console errors, no blank pane, chat input still accepts a second message

#### Contract Check — Interrupt Is Low-Level

- [ ] Confirm a plain conversational message ("What's the weather?") does not render a picker and does not call `schedule_meeting`
- [ ] Confirm no approval-dialog-style modal appears at any point (this demo is inline, not modal — contrast `hitl-in-app`, which portals a modal)

### 3. Re-qualification checklist — BLOCKED, do not tick

Run only after the `@copilotkit/react-core/v2` resume-path fix ships AND an interrupt signal exists on this backend. These are the reference behaviors this cell owes; each one is currently unreachable.

- Picker renders INLINE in the transcript (`time-picker-card`), a descendant of the chat container, NOT portaled to `<body>`
- Card header shows the outline badge "Book a call", the agent-supplied topic as the title, "With <attendee>" when present, and the description "Pick a time that works for you."
- A 2-column grid of `time-picker-slot` buttons; with no backend-supplied slots the fallback labels are "Tomorrow 10:00 AM", "Tomorrow 2:00 PM", "Monday 9:00 AM", "Monday 3:30 PM"
- A ghost `time-picker-cancel` button labeled "None of these work" below the grid
- Pick path: card switches to `time-picker-picked` (green-tinted, "Booked" badge + bold slot label), all buttons disable, and `resolve({chosen_time, chosen_label})` fires after the deliberate 500ms commit delay in `page.tsx`
- Cancel path: card switches to `time-picker-cancelled` ("Cancelled" badge + "No time picked.") and `resolve({cancelled: true})` fires
- **Turn 2 (the quarantined step):** the agent resumes and appends a confirmation assistant bubble naming the chosen slot, or noting the cancellation. This is exactly what the react-core bug drops
- Multi-turn: a fresh independent picker renders for a follow-up booking prompt while the earlier card stays in its resolved state
- Double-click a slot button rapidly: only one selection commits

## Expected Results

- Chat loads within 3 seconds; plain-text response within 10 seconds
- A booking prompt produces a `schedule_meeting` tool call on the wire within 20 seconds
- No inline picker card, and therefore no pick/cancel/resume flow, while the cell is quarantined — this is the accepted outcome, honestly marked skipped-incapable in `manifest.yaml` (not green, not red)
- No UI layout breaks and no uncaught console errors at any point
- Anything that contradicts the two verified facts in the Prerequisites (a picker that mounts, an `on_interrupt` event on the wire) is a finding worth reporting, not a pass
