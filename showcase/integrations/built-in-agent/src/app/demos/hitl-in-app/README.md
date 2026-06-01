# In-App HITL (built-in-agent)

App-level approval dialog driven by an async `useFrontendTool` handler. The
agent calls `request_user_approval`; the handler returns a Promise that is
resolved by a modal dialog rendered outside the chat (portal'd to `<body>`).
The user's Approve / Reject click flips the pending Promise and the result
is fed back to the agent as the tool's call result.

- Frontend pattern only — uses the default `/api/copilotkit` runtime
- Agent: built-in `BuiltInAgent` factory with `gpt-4o`
- Key files: `page.tsx`, `approval-dialog.tsx`
