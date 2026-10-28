import { createHash } from "node:crypto";
import type { RunAgentInput } from "@ag-ui/client";
import type { CopilotRuntimeOptions } from "../../core/runtime";

export function normalizeA2UIAction(
  input: RunAgentInput,
  config: CopilotRuntimeOptions["a2ui"],
  agentId: string,
): RunAgentInput | Response {
  if (
    config?.actionTransport !== "user-message" ||
    config.enabled === false ||
    (config.agents && !config.agents.includes(agentId))
  )
    return input;

  const envelope = input.forwardedProps?.a2uiAction;
  if (envelope === undefined) return input;
  if (
    !envelope ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    !envelope.userAction ||
    typeof envelope.userAction !== "object" ||
    Array.isArray(envelope.userAction)
  ) {
    return Response.json(
      { error: "Invalid A2UI user action" },
      { status: 400 },
    );
  }

  // Normalize before the runner records its input, not inside agent middleware.
  // This is user intent, never evidence that a tool has executed or been approved.
  const id = `a2ui-action-user-${createHash("sha256")
    .update(JSON.stringify([input.threadId, input.runId]))
    .digest("hex")}`;
  const content = JSON.stringify({ a2uiAction: envelope });
  const actionName =
    typeof envelope.userAction.name === "string"
      ? envelope.userAction.name
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/[_-]+/g, " ")
          .trim()
          .slice(0, 120)
      : "";
  // Presentation metadata is separate from the canonical, model-visible payload.
  // Renderers must require this explicit marker, never infer actions from JSON.
  const display = {
    version: 1,
    label: actionName
      ? (actionName[0].toUpperCase() + actionName.slice(1)).slice(0, 120)
      : "Selected an action",
  };
  const existing = input.messages.find((message) => message.id === id);
  if (existing && (existing.role !== "user" || existing.content !== content)) {
    return Response.json(
      { error: "Conflicting A2UI action identity" },
      { status: 400 },
    );
  }
  // Consuming the forwarded action prevents the legacy middleware from also
  // manufacturing a log_a2ui_event assistant/tool pair for this same click.
  const { a2uiAction: _action, ...forwardedProps } = input.forwardedProps;
  return {
    ...input,
    forwardedProps,
    messages: existing
      ? input.messages.map((message) =>
          message.id === id
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  "copilotkit.a2uiAction": display,
                },
              }
            : message,
        )
      : [
          ...input.messages,
          {
            id,
            role: "user",
            content,
            metadata: { "copilotkit.a2uiAction": display },
          },
        ],
  };
}
