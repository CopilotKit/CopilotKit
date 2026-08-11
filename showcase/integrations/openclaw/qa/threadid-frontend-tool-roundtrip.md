# QA: Frontend Tool Thread Round Trip (OpenClaw)

Demo source: `src/app/demos/threadid-frontend-tool-roundtrip/page.tsx`
Route: `/demos/threadid-frontend-tool-roundtrip` · Agent: `threadid-frontend-tool-roundtrip`
Run against the real backend at `http://localhost:3119/demos/threadid-frontend-tool-roundtrip`.

Status: **supported** (mechanism-verified). Rides the same frontend-forwarded
client-tools path that `frontend-tools` verified end-to-end at the gateway level
(see `PARITY_NOTES.md`); the threadId behaviour is frontend/runtime-side and does
not depend on any gateway feature.

## What it exercises

A frontend tool round-trip under two threadId modes. A single tool,
`testFrontendToolCalling`, is defined in React with `useFrontendTool`; it takes
one string arg, `label`, and its handler returns `` `handled ${label}` `` — i.e.
the model asks for a label, the browser echoes it back, and the result is fed
back into the run (`followUp: true`) so the assistant references it in its reply.

A header checkbox, **Explicit threadId**, switches the `CopilotChatConfigurationProvider`
between two modes:

- **SDK-generated thread** (default) — no `threadId` passed; the SDK generates one.
- **Explicit thread** — `threadId` is pinned to the fixed value
  `a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580` with `hasExplicitThreadId`.

Toggling the checkbox remounts the provider (its `key` changes), so each mode
starts a fresh chat. The header line (`data-testid="ent-658-thread-mode"`) reads
"SDK-generated thread" or "Explicit thread" to reflect the current mode.

Because OpenClaw is a single stateless gateway with no per-demo backend, the tool
is **frontend-forwarded**: its schema rides over AG-UI in `RunAgentInput.tools`,
the ag-ui adapter hands it to OpenClaw as a caller-provided **client tool**,
and when the model calls it the run stops on the pending tool call while the page
handler runs locally.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy. Note the agent id `threadid-frontend-tool-roundtrip` is not
  in the runtime's explicit agent-name list, so it resolves to the shared
  `default` agent — the same pass-through gateway target every demo uses.

## Manual steps

1. Open the demo. Confirm the chat renders (no welcome screen) and the header
   reads **"SDK-generated thread"**.
2. Ask: **"Call testFrontendToolCalling with the label hello."**
3. Expect: the agent calls `testFrontendToolCalling`; the tool card
   (`data-testid="ent-658-tool-card"`) shows `label: hello` and
   `result: handled hello`; the assistant's follow-up reply references the echoed
   label.
4. Check the checkbox to switch to **Explicit threadId**. Confirm the header now
   reads **"Explicit thread"** and the chat has reset (fresh transcript).
5. Repeat step 2 with a different label (e.g. **"...with the label world."**) and
   confirm the same round-trip: card shows `label: world` / `result: handled world`.
6. (Optional) Reload the page while in **Explicit thread** mode and confirm it
   comes back up in explicit mode wired to the same fixed threadId.

## Assertion bar

- The tool card shows both the exact `label` the model supplied and the matching
  `handled <label>` result — the round-trip actually completed (not just a
  "success" message).
- Exactly one tool-call sequence per request (no duplicate render).
- The assistant reply after the tool result is coherent and references the label.
- Toggling the checkbox flips the header text and resets the conversation.

## Caveats

- The handler always returns `` `handled ${label}` `` — it does no validation and
  has no failure path; whatever label the model passes is echoed verbatim.
- ThreadId behaviour (generated vs explicit/fixed) is enforced entirely by the
  frontend + CopilotKit runtime. The OpenClaw gateway is stateless and does not
  persist per-thread history, so "same thread" here means the SDK keeps sending
  the same accumulated message history under a stable id — not server-side
  session storage on the gateway.
- Behaviour comes from the frontend + ag-ui client-tools path, not a per-demo
  backend graph — the same mechanism backs the other frontend-tool demos.
