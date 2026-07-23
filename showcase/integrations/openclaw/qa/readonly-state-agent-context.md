# QA: Read-Only Agent Context (OpenClaw)

Demo source: `src/app/demos/readonly-state-agent-context/page.tsx`
Route: `/demos/readonly-state-agent-context` · Agent: `readonly-state-agent-context`
Run against the real backend at `http://localhost:3119/demos/readonly-state-agent-context`.

Status: **supported** (see `PARITY_NOTES.md`, "State / context"). Not yet
individually e2e-verified at the gateway level — it rides the proven
`useAgentContext` → AG-UI `context[]` mechanism shared with agent-config.

## What it exercises

Three pieces of **read-only** context published to the agent via
`useAgentContext`: the user's display **name** (default `Atai`), **timezone**
(default `America/Los_Angeles`), and **recent activity** (a string array,
default: "Viewed the pricing page" + "Watched the product demo video"). Editing
the form fields updates the values live; the "Published Context" card mirrors the
exact JSON payload broadcast on every render.

OpenClaw is a single stateless gateway with no per-demo backend, so there is no
state graph here. `useAgentContext` puts each value into `RunAgentInput.context[]`
over AG-UI; the ag-ui adapter injects that context into the prompt for every
run. The agent can **read** the context but **cannot modify** it — the form is
the sole owner of the values (this is the read-only counterpart to the
shared-state demos, which use `forwardedProps.stateWriterTools`).

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (every per-demo agent name maps to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the page renders the "Agent Context Inspector" with an
   **Identity** card (Name = `Atai`, Timezone = `America/Los_Angeles`), a
   **Recent Activity** card with 2 of 5 items checked, and a **Published Context**
   card whose JSON shows `name`, `timezone`, and a 2-item `recentActivity`.
2. Confirm the `CopilotPopup` chat renders (open by default) with placeholder
   "Ask about your context...".
3. Click the **"Who am I?"** suggestion (or ask "What is my name?"). Expect the
   agent to address you as **Atai** and reflect the two checked activities.
4. Edit the **Name** field to `Jamie`. Confirm the Published Context JSON updates
   to `"name": "Jamie"` immediately. Ask "What is my name?" again — the agent now
   answers **Jamie**, not Atai (context is re-sent every turn; no stale value).
5. Change the **Timezone** to `Asia/Tokyo`. Confirm the JSON updates, then click
   **"Plan my morning"**. Expect the response to reference Tokyo / JST / Asia/Tokyo.
6. Uncheck the defaults and check only "Started the 14-day free trial" and
   "Invited a teammate". Confirm the JSON `recentActivity` array updates, then
   click **"Suggest next steps"** — the response should reference the trial /
   invited-teammate items, not the pricing page or demo video.

## Assertion bar

- Every edit to Name / Timezone / Activity reflects in the Published Context JSON
  (`data-testid="ctx-state-json"`) immediately.
- Agent responses reflect the **current** context on every turn — changing a value
  and re-asking yields the new value, not the previous one.
- The agent never mutates the form: Name (`data-testid="ctx-name"`), Timezone
  (`data-testid="ctx-timezone"`), and the activity checkboxes stay user-controlled.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` with a populated `context[]`
(e.g. name / timezone / recentActivity entries) to
`http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and confirm the streamed text reflects those context
values — no `STATE_SNAPSHOT` or tool call is expected for this read-only demo.

## Caveats

- Behaviour comes from the frontend + ag-ui context injection, not a per-demo
  backend graph — the same mechanism backs agent-config.
- Clearing the Name to empty publishes `"name": ""`; the agent handles it as an
  unknown/anonymous user (no crash). The identity avatar falls back to `?` and
  the name to "Anonymous" in the UI.
- Because context is only injected as prompt text (not a tool), the agent's use of
  it is best-effort — a weak model may occasionally under-use a value; re-asking
  or a stronger model input improves fidelity.
