# interrupt_frontend_tools — manual test app (temporary)

> Draft-only. Remove this folder before the PR leaves draft.

A mini chat to exercise the Python side of this PR end to end:

- `CopilotKitMiddleware(interrupt_frontend_tools=True)`: each frontend tool call
  pauses on its own `interrupt()` in the tool node.
- `LangGraphAGUIAgent`: resumes parallel interrupts with LangGraph's
  id-keyed map, and re-emits only the calls that are still open.

The agent loads this branch's `sdk-python` as an editable install. The frontend
uses the published `@copilotkit/*` packages. This PR changes no React code.

| Tool             | Where    | What it checks                                                |
| ---------------- | -------- | ------------------------------------------------------------- |
| `get_time`       | backend  | ordinary server tools still run next to paused frontend calls |
| `show_graph`     | frontend | handler runs **exactly once** (counter in the header)         |
| `confirm_action` | frontend | HITL: the call stays paused until the user answers            |

## Run

```bash
export ANTHROPIC_API_KEY=...        # MODEL=... overrides claude-sonnet-5
npm install && (cd agent && uv sync)
npm run dev                         # UI :3000, agent :8123
```

Prompt:

> In ONE turn call all three tools in parallel: get_time, show_graph titled
> 'demo' with values [3,5,2,8], and confirm_action with action 'delete file'.

Expected: a chart plus an Approve/Reject card, and the counter at 1. After you
answer, a single resume carries both results and the agent finishes the same
turn. The counter stays at 1.

## Verified

- Backend over AG-UI (no browser): one run returns the `get_time` result plus
  two `reason: "tool_call"` interrupts, each with its own `toolCallId`.
  Resuming only `show_graph` leaves only `confirm_action` open. Resuming that
  one completes the turn with both real results.
- Browser (headless Chrome): the handler runs once, the HITL answer is
  forwarded, the turn completes, and a follow-up turn works.

## Client-side findings (out of scope here — for PR comments)

Neither is fixed in this PR. The example works around the first.

1. **A naive bridge hangs after an HITL answer.** Core records a frontend tool
   result with `agent.messages.splice(...)` (`packages/core/src/core/run-handler.ts`),
   which fires no messages-changed notification. A bridge that re-checks only on
   `OnMessagesChanged` therefore never sees a result that lands after the
   interrupt arrives, and every HITL answer lands after. `show_graph` only works
   because its result already exists when the bridge mounts. The example also
   re-checks one tick after `onToolExecutionEnd`. Open `/?naive` to run it without
   the re-check and watch it hang.
2. **Tool results are duplicated on the client.** When the resume goes out,
   `useInterrupt` adds its own `role: "tool"` message for every `tool_call`
   interrupt, even when the client already recorded that call's result.
   `agent.messages` ends up holding two results per call. It did not break the
   next turn here (the server checkpoint is authoritative), but the client
   history is wrong.
