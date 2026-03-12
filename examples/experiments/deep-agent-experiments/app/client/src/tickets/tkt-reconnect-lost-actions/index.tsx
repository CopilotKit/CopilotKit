import type { TicketMeta } from "@/lib/ticket-types";
import ScenarioBroken from "./scenario-broken";

export const meta: TicketMeta = {
  title: "Frontend actions lost on thread reconnect (langchain_messages_to_copilotkit bug)",
  refs: [
    "https://copilotkit.slack.com/archives/C09C4HRL8F9/p1769635454992139",
  ],
  notes:
    "Bug 1: langchain_messages_to_copilotkit() uses if/else on AIMessage.tool_calls — " +
    "when tool_calls exist, no assistant message is created, so parentMessageId references " +
    "a nonexistent message. On thread reconnect, the frontend action component is lost.\n\n" +
    "Bug 2: copilotkit_messages_to_langchain() collects tool calls by parentMessageId " +
    "without filtering by message type, so non-ActionExecutionMessage messages with the " +
    "same ID cause KeyError on missing 'name'.\n\n" +
    "Fix: Always emit the assistant message, then conditionally emit tool calls (change " +
    "if/else to always + if). Filter by type == 'ActionExecutionMessage' in reverse conversion.",
};

export default function TktReconnectLostActions() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">
        Frontend actions lost on thread reconnect
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Send "support" to trigger the <code>get_help</code> frontend tool — a "Get Help"
        button should render. Then click <strong>Disconnect → Reconnect</strong> to
        rejoin the same thread. The button disappears because{" "}
        <code>langchain_messages_to_copilotkit()</code> skips the parent assistant
        message when <code>tool_calls</code> exist, leaving{" "}
        <code>parentMessageId</code> dangling.
      </p>

      <div className="border rounded-lg overflow-hidden mb-4">
        <ScenarioBroken />
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
        <h3 className="font-semibold text-sm text-gray-700 mb-2">Root cause</h3>
        <div className="text-xs text-gray-600 space-y-2">
          <p>
            In <code>copilotkit/langgraph.py</code>, the{" "}
            <code>langchain_messages_to_copilotkit()</code> function has:
          </p>
          <pre className="bg-gray-100 p-2 rounded text-[11px] overflow-x-auto">{`elif isinstance(message, AIMessage):
    if message.tool_calls:
        for tool_call in message.tool_calls:
            result.append({
                "id": tool_call["id"],
                "parentMessageId": message.id,  # ← parent never created!
            })
    else:
        result.append({
            "role": "assistant",
            "content": content,
            "id": message.id,
        })`}</pre>
          <p>
            <strong>Fix:</strong> Always create the assistant message, then conditionally
            add tool calls:
          </p>
          <pre className="bg-green-50 p-2 rounded text-[11px] overflow-x-auto border border-green-200">{`elif isinstance(message, AIMessage):
    result.append({
        "role": "assistant",
        "content": content,
        "id": message.id,
    })
    if message.tool_calls:
        for tool_call in message.tool_calls:
            result.append({
                "id": tool_call["id"],
                "parentMessageId": message.id,
            })`}</pre>
        </div>
      </div>
    </div>
  );
}
