/** Clarification is for ambiguity, not a way to negotiate around a failed action. */
export function hasFailedToolOutcome(
  messages: readonly { role: string; content?: unknown }[],
): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return messages.slice(lastUserIndex + 1).some((message) => {
    if (message.role !== "tool" || typeof message.content !== "string")
      return false;
    if (message.content.startsWith("Error:")) return true;
    try {
      const result = JSON.parse(message.content) as { status?: unknown };
      return ["failed", "partial", "refused", "denied", "uncertain"].includes(
        typeof result.status === "string" ? result.status : "",
      );
    } catch {
      return false;
    }
  });
}
