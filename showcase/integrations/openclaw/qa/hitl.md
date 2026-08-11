# QA: Human in the Loop (OpenClaw)

Demo source: `src/app/demos/hitl/page.tsx`
Route: `/demos/hitl` · Agent: `human_in_the_loop`
Run against the real backend at `http://localhost:3119/demos/hitl`.

Status: **supported** via the tool-based (`promise`/`respond()`) HITL pattern —
see `PARITY_NOTES.md`. One caveat: the demo also wires `useInterrupt`, which
relies on LangGraph-native resumable `interrupt()` semantics the gateway does
**not** back; see Caveats.

## What it exercises

A plan-and-approve loop. The page registers a single human-in-the-loop tool with
`useHumanInTheLoop`, `generate_task_steps`, whose args are a `steps` array
(each `{ description, status }`). When the model calls it, the run pauses and the
page renders `StepsFeedback` — a "Review Steps" card with a checkbox per step and
**Confirm** / **Reject** buttons. The user's decision is sent back to the model
via the tool's `respond()` callback, and the conversation continues.

OpenClaw is a single stateless gateway with no per-demo backend, so
`generate_task_steps` is **frontend-forwarded**: its schema rides over AG-UI in
`RunAgentInput.tools`, the ag-ui adapter hands it to OpenClaw as a
caller-provided **client tool** (the only tool list the gateway exposes to the
model). When the model calls it, the run stops on a pending tool call, ag-ui
emits `TOOL_CALL_START/ARGS/END`, the card renders, and `respond()` supplies the
tool result that resumes the run. This is the fleet's `promise-based` HITL
pattern — not a resumable graph checkpoint.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the `CopilotChat` renders full-height and centered.
2. Click the **Simple plan** suggestion chip (or ask: **"Please plan a trip to
   mars in 5 steps."**).
3. Expect: the agent calls `generate_task_steps`; a **Review Steps** card appears
   inline in the chat listing the steps, each with a checkbox (enabled by
   default) and a `N/N selected` badge.
4. Uncheck one or two steps and confirm the count badge updates and unchecked
   rows show strikethrough text.
5. Click **Confirm (N)**. Expect: the card locks (buttons gone), an **Accepted**
   badge appears, and the model continues — its follow-up response reflects the
   selected steps.
6. Repeat with the **Complex plan** chip (pasta, 10 steps); this time click
   **Reject**. Expect: a **Rejected** badge and a model response that
   acknowledges the rejection rather than proceeding.

## Assertion bar

- Exactly one Review Steps card per `generate_task_steps` call (no duplicate
  render).
- The card is interactive only while pending (`status === "executing"`);
  checkboxes/buttons are disabled otherwise.
- Confirm sends `{ accepted: true, steps: [...enabled] }`; Reject sends
  `{ accepted: false }`. The model's continuation is coherent with the decision.
- The decision badge (Accepted / Rejected) persists after the run completes.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying a
`generate_task_steps` tool to `http://127.0.0.1:8000/v1/ag-ui/operator`
(Bearer gateway token, `Accept: text/event-stream`) and confirm the SSE contains
a `TOOL_CALL_START` for `generate_task_steps` with a `steps` array in its args,
then that the run pauses on that pending tool call (no `RUN_FINISHED` until a
tool result is supplied).

## Caveats

- **`useInterrupt` is not backed by the gateway.** The page also registers a
  `useInterrupt` handler (rendering `StepSelector`). Resumable `interrupt()` is
  LangGraph-native and `PARITY_NOTES.md` lists it under "Not supported" for
  OpenClaw — the StepSelector path is not expected to fire against the real
  gateway. All working HITL here flows through the `useHumanInTheLoop`
  (`generate_task_steps`) tool path above.
- The step statuses the model emits are `enabled` / `disabled` / `executing`;
  the card treats anything not `enabled` as unchecked. A malformed status from
  the model simply renders as unchecked.
- Behaviour comes from the frontend + ag-ui client-tools path, not a per-demo
  backend graph — the same mechanism backs the other HITL demos (hitl-in-chat,
  hitl-in-app).
