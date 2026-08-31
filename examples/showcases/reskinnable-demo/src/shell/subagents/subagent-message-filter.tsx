"use client";

import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessageProps } from "@copilotkit/react-core/v2";
import { useSubagentActivity } from "./subagent-activity";

/**
 * The transcript's assistant-message renderer, minus anything a SUBAGENT said.
 *
 * A delegating agent produces two very different kinds of prose in one stream.
 * The parent's ("Done — I analysed the statement and filed the reimbursable
 * charges") is a reply to the user and belongs in the conversation. A
 * subagent's ("The download has a valid CSV header, not an HTML error page —
 * I'll now parse it programmatically…") is work-in-progress narration, and
 * inline it reads badly: a wall of interim status scrolling above whatever
 * component is meant to be the answer, with the run's console sitting empty
 * beside it.
 *
 * So subagent narration is routed to the console instead (see
 * `src/skins/banking/components/harness-console.tsx`) and suppressed here. The
 * console is then the single place the harness's work is visible, which is the
 * whole point of having a console.
 *
 * ## Why this is safe to apply shell-wide
 *
 * It keys off `subagentRunId`, which is protocol-level and says nothing about
 * which skin or agent produced the message. A skin whose agent has no subagents
 * emits no tagged messages, so nothing is ever suppressed for it — the
 * suppression set is empty and this renders exactly like the default. That makes
 * it a shell capability rather than a banking special case.
 *
 * ## Failure mode to know about
 *
 * The tag lives on the LIVE event stream; the persisted messages do not carry
 * it (measured: 0 of 55). So the suppression set is rebuilt by replaying the
 * thread's events, and if a consumer somehow renders messages before those
 * events arrive, subagent narration appears for a moment and then disappears.
 * Visible-then-hidden is the correct direction to fail: the alternative —
 * hiding first — would blank the parent's real reply on a slow load.
 */
const Filtered = (props: CopilotChatAssistantMessageProps) => {
  const { subagentMessageIds } = useSubagentActivity();
  const message = props.message;
  const suppressed = Boolean(message?.id && subagentMessageIds.has(message.id));

  if (!suppressed) return <CopilotChatAssistantMessage {...props} />;

  // Suppress the PROSE, keep the TOOL CALLS.
  //
  // An agent routinely narrates and calls a tool in the SAME assistant message,
  // so returning `null` here throws away both. That is not hypothetical: it hid
  // the offsite-expenses REPORT CARD, because the analyst's closing narration
  // and its `submit_expense_report` call shared one message. The run looked
  // perfect and simply ended with nothing to show.
  //
  // A tool call is not narration — it is a rendered component the skin
  // registered on purpose (a report card, a chart, an approval queue) and it
  // belongs in the conversation wherever it came from. Only the prose moves to
  // the console.
  const toolCalls = (message as { toolCalls?: unknown[] } | undefined)
    ?.toolCalls;
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <CopilotChatAssistantMessage
      {...props}
      message={{ ...message, content: "" }}
    />
  );
};

/**
 * The slot is typed as `typeof CopilotChatAssistantMessage`, which carries
 * static sub-components (`MarkdownRenderer`, `Toolbar`, `CopyButton`, …) that
 * the chat view reaches for by name. A bare function loses them, so copy them
 * across — this is a filter in front of the default renderer, not a replacement
 * for it, and it has to keep the same surface.
 */
export const SubagentFilteredAssistantMessage = Object.assign(
  Filtered,
  CopilotChatAssistantMessage,
);
