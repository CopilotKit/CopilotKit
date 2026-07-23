# QA: Agentic Chat (Reasoning) — Langroid

NOTE: The Langroid AG-UI adapter does not currently emit
`REASONING_MESSAGE_*` events. The custom `reasoningMessage` slot is wired,
but the reasoning card only renders once the backend emits such messages.

## Test Steps

- [ ] Navigate to /demos/agentic-chat-reasoning
- [ ] Verify chat input is visible
- [ ] Send a query; verify a normal assistant reply
