// Docs-only snippet — not imported or run. The shell-docs page at
// `/integrations/claude-sdk-typescript/human-in-the-loop/useInterrupt`
// references the `backend-tool-call` region to teach the Strategy B
// pattern: the agent has no local `schedule_meeting` implementation,
// the tool is registered entirely on the frontend via `useFrontendTool`,
// and the backend's only job is to instruct the model to call the
// frontend tool whenever the user wants to book a meeting.
//
// Why a sibling teaching file instead of in-place markers?
// In production, claude-sdk-typescript runs a single shared Express
// agent server (`src/agent/index.ts`) that pass-through-forwards every
// AG-UI tool definition to Claude with a generic system prompt. There
// is no per-demo backend file or per-demo system prompt to mark up.
// Annotating the shared server with `backend-tool-call` markers would
// either span unrelated runtime plumbing or highlight a generic
// "You are a helpful AI assistant" string that does not match the MDX
// caption. This sibling exposes the canonical Strategy B shape so the
// docs render the right teaching code, mirroring the
// claude-sdk-python `interrupt_agent.py` reference.

// @region[backend-interrupt-tool]
// @region[backend-tool-call]
// The backend instructs the model to call the frontend-defined
// `schedule_meeting` tool. The tool itself is registered on the
// frontend with `useFrontendTool`; AG-UI forwards the frontend tool
// schemas to Claude, and Claude's tool call is routed back to the
// frontend handler that renders the picker and resolves with the
// user's choice.
const SYSTEM_PROMPT = `
You are a scheduling assistant. Whenever the user asks you to book a
call or schedule a meeting, you MUST call the \`schedule_meeting\` tool.
Pass a short \`topic\` describing the purpose of the meeting and, if
known, an \`attendee\` describing who the meeting is with.

The \`schedule_meeting\` tool is implemented on the client: it surfaces
a time-picker UI to the user and returns the user's selection. After
the tool returns, briefly confirm whether the meeting was scheduled
and at what time, or note that the user cancelled. Do NOT ask for
approval yourself — always call the tool and let the picker handle
the decision.

Keep responses short and friendly. After you finish executing tools,
always send a brief final assistant message summarizing what happened
so the message persists.
`.trim();
// @endregion[backend-tool-call]
// @endregion[backend-interrupt-tool]

export { SYSTEM_PROMPT };
