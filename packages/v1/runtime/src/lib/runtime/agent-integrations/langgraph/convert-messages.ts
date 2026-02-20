import type { Message } from "@ag-ui/client";

/**
 * Convert an array of LangGraph messages to AG-UI Message format.
 *
 * LangGraph messages use `type` ("human", "ai", "tool", "system") while
 * AG-UI uses `role` ("user", "assistant", "tool", "system") with different
 * required fields per role.
 */
export function convertLangGraphMessages(messages: any[]): Message[] {
  return messages
    .map((msg: any): Message | null => {
      const msgType: string = msg.type;

      if (msgType === "tool") {
        return {
          id: msg.id,
          role: "tool" as const,
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content ?? ""),
          toolCallId: msg.tool_call_id ?? msg.id,
        };
      }

      if (msgType === "human") {
        let content: string;
        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content =
            msg.content
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("") || "";
        } else {
          content = String(msg.content ?? "");
        }
        return { id: msg.id, role: "user" as const, content };
      }

      if (msgType === "ai") {
        const base: Record<string, unknown> = {
          id: msg.id,
          role: "assistant" as const,
        };
        if (typeof msg.content === "string" && msg.content.length > 0) {
          base.content = msg.content;
        } else if (Array.isArray(msg.content)) {
          const text = msg.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("");
          if (text.length > 0) base.content = text;
        }
        if (msg.tool_calls?.length) {
          base.toolCalls = msg.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args),
            },
          }));
        }
        return base as Message;
      }

      if (msgType === "system") {
        return {
          id: msg.id,
          role: "system" as const,
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content ?? ""),
        };
      }

      // Unknown type - return null to be filtered
      return null;
    })
    .filter((msg): msg is Message => msg !== null);
}
