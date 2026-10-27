/** Compatibility boundary for the native Claude emitter. See child-history-contract.md. */
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const toolName = (name: string) => name.replace(/^mcp__ag_ui__/, "");

export function adaptChildHistoryEvent(
  e: Record<string, unknown>,
): Record<string, unknown> {
  if (e.type === "CUSTOM" && e.name === "claude:assistant_content") {
    const value = object(e.value);
    return {
      ...e,
      name: "cpki.child_assistant_content",
      value: {
        ...value,
        content: Array.isArray(value.content)
          ? value.content.flatMap((raw): Record<string, unknown>[] => {
              const b = object(raw);
              if (b.type === "text" && typeof b.text === "string")
                return [{ type: "text", text: b.text }];
              if (b.type === "thinking" && typeof b.thinking === "string")
                return [{ type: "reasoning", text: b.thinking }];
              if (
                b.type === "tool_use" &&
                typeof b.id === "string" &&
                typeof b.name === "string"
              )
                return [
                  {
                    type: "tool_call",
                    id: b.id,
                    name: toolName(b.name),
                    args: b.input,
                  },
                ];
              return [];
            })
          : value.content,
      },
    };
  }
  if (e.type === "RUN_FINISHED") {
    const outcome = object(e.outcome);
    if (outcome.type !== "interrupt" || !Array.isArray(outcome.interrupts))
      return e;
    return {
      ...e,
      outcome: {
        ...outcome,
        interrupts: outcome.interrupts.map((raw) => {
          const interrupt = object(raw),
            metadata = object(interrupt.metadata);
          return metadata.source === "claude-sdk-native-child"
            ? {
                ...interrupt,
                metadata: {
                  ...metadata,
                  source: "cpki.child",
                  toolName:
                    typeof metadata.toolName === "string"
                      ? toolName(metadata.toolName)
                      : metadata.toolName,
                },
              }
            : raw;
        }),
      },
    };
  }
  if (e.type === "TOOL_CALL_RESULT" && !e.childHistory) {
    const raw = object(e.rawEvent);
    return {
      ...e,
      childHistory: {
        parentToolCallId: raw.parent_tool_use_id,
        isError: raw.is_error,
      },
    };
  }
  return e;
}
