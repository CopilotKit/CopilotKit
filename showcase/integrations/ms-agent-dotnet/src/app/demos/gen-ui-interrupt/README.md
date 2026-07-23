# gen-ui-interrupt (Microsoft Agent Framework, .NET — adapted)

Interrupt-based Generative UI demo, adapted for the .NET showcase.

## Adaptation

The LangGraph reference uses LangGraph's `interrupt()` primitive to pause
execution inside a backend tool and surface a payload to the frontend's
`useInterrupt` hook. The Microsoft Agent Framework (.NET) has no
equivalent pause/resume primitive.

This demo uses an **approval-mode shim** instead:

- `useFrontendTool` declares a `schedule_meeting` tool on the client with
  an `async` handler.
- The backend agent (see `agent/InterruptAgent.cs`) is prompted to call
  `schedule_meeting` whenever the user wants to book a meeting.
- The frontend handler renders the `TimePickerCard` in chat, awaits the
  user's choice, and returns a plain-text result string that mirrors the
  LangGraph backend tool's return value.

Visually and semantically this is indistinguishable from the LangGraph
interrupt flow. Mechanism differs.

## Backend

Mounted at `/interrupt-adapted` on the .NET agent process (see
`agent/Program.cs`). The Next.js runtime route maps the `gen-ui-interrupt`
agent name to that path.
