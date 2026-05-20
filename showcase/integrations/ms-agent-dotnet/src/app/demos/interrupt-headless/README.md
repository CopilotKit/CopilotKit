# interrupt-headless (Microsoft Agent Framework, .NET — adapted)

Headless Interrupt demo, adapted for the .NET showcase.

## Adaptation

The LangGraph reference subscribes to the agent's custom-event stream via
`useCopilotKit` + `agent.subscribe(...)` to observe LangGraph `interrupt()`
events and render a picker in an external "app surface" pane. The Microsoft
Agent Framework (.NET) has no `interrupt()` primitive, so we simulate the
behavior with the same **approval-mode shim** used by `gen-ui-interrupt`.

Key difference from the in-chat variant:

- The `useFrontendTool` render callback returns `null` (nothing is
  rendered inside the chat transcript).
- The picker is rendered in the left-pane `AppSurface`, reading `pending`
  state that the async handler sets when it's invoked and clears when it
  resolves.

## Backend

Shares `/interrupt-adapted` on the .NET agent process with
`gen-ui-interrupt`. See `agent/InterruptAgent.cs` and `agent/Program.cs`.
The Next.js runtime route maps the `interrupt-headless` agent name to that
path.
