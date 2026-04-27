# In-App HITL

## What This Demo Shows

A support-ops copilot that asks for **explicit operator approval** before taking any action that affects a customer. The approval UI is a modal dialog rendered **OUTSIDE the chat surface** — the agent pauses mid-turn, the operator approves/rejects in the app, and control returns to the agent with the decision as the tool result.

## How to Interact

Try asking your Copilot to:

- "Please approve a $50 refund to Jordan Rivera on ticket #12345 for the duplicate charge."
- "Please downgrade Priya Shah (#12346) to the Starter plan effective next billing cycle."
- "Please escalate ticket #12347 to the payments team — Morgan Lee's payment is stuck."

For each request the agent calls `request_user_approval` with a short action summary. A modal pops up in the app (not inside the chat bubble). Click **Approve** or **Reject** — optionally add a note — and the agent's next turn reflects your decision.

## Technical Details

What's happening technically:

- **.NET agent backend** — `agent/HitlInAppAgent.cs` exposes a plain `ChatClientAgent` with **no server-side tools** and a support-ops system prompt. Mounted at `/hitl-in-app` via `Program.cs`.
- **Frontend tool** — `useFrontendTool({ name: "request_user_approval", handler })` registers the tool on the client. The `handler` returns a `Promise` whose `resolve` function is captured in component state.
- **Modal outside chat** — clicking Approve/Reject in `ApprovalDialog` (portal'd to `document.body`) calls the captured `resolve(...)`, which completes the handler's promise and hands `{ approved, reason }` back to the agent as the tool result.
- **Runtime wiring** — `src/app/api/copilotkit/route.ts` registers `hitl-in-app` as an `HttpAgent` pointing at `${AGENT_URL}/hitl-in-app` so it runs with its own system prompt rather than the sales pipeline prompt exposed at `/`.

## Building With This

If you're extending this demo or building something similar, here are key things to know:

### Async Frontend Tool Handlers

A frontend tool handler can return a Promise — the agent waits. Stash the resolver in component state:

```tsx
useFrontendTool({
  name: "request_user_approval",
  parameters: z.object({ message: z.string() }),
  handler: async ({ message }) =>
    new Promise<{ approved: boolean }>((resolve) => {
      setDialog({ open: true, message, resolve });
    }),
});
```

The modal's Approve / Reject button calls `dialog.resolve(...)` and the agent's next turn reflects the decision.

### Modal Outside the Chat

Use `createPortal(content, document.body)` so the dialog overlays the whole app, not just the chat bubble tree. This keeps the chat transcript clean — the approval UX is a separate app-level concern.

### Dedicated Agent, Main Runtime

The HITL agent has its own backend endpoint (`/hitl-in-app`) but reuses the main `/api/copilotkit` runtime. In the runtime, the `hitl-in-app` agent name points to `${AGENT_URL}/hitl-in-app` while the other agent names keep pointing at `/`.

Reference parity: `showcase/packages/langgraph-python/src/app/demos/hitl-in-app/`.
