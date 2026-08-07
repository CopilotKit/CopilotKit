import { useCallback } from "react";
import type { ReactElement } from "react";
import { partialJSONParse } from "@copilotkit/shared";
import { useCopilotKit } from "@copilotkit/react-core/v2/headless";
import { useRenderToolRegistry } from "./RenderToolContext";

/** A tool call as it appears on an assistant message. */
export interface RenderableToolCall {
  id: string;
  function: { name: string; arguments?: string };
}

export interface RenderToolCallInput {
  toolCall: RenderableToolCall;
  /** The matching tool result message, when the call has produced one. */
  toolMessage?: { content?: string } | undefined;
}

/**
 * Render a tool call using the render function registered for it, ANYWHERE in your app.
 *
 * `CopilotChat` renders tool calls inline in its own message list, which is the right default for a
 * chat. But plenty of React Native surfaces are not chats — an in-car stage, a kiosk, a dashboard —
 * and they still want the agent to drive the UI. Without this hook there was no public way to render
 * a registered component outside the chat, which also made `useComponent` unusable on those surfaces.
 *
 * Arguments are partial-JSON-parsed, so a component paints as the agent writes the call
 * (`status: "inProgress"`) and fills in as more arrives — the same progressive behaviour the web
 * renderer has. Renderers therefore need to tolerate incomplete `args`.
 *
 * @example
 * ```tsx
 * const renderToolCall = useRenderToolCall();
 *
 * // panels the agent has called this turn, laid out however you like
 * return <View>{toolCalls.map((tc) => renderToolCall({ toolCall: tc }))}</View>;
 * ```
 */
export function useRenderToolCall(): (
  input: RenderToolCallInput,
) => ReactElement | null {
  // The registry Map, same source CopilotChat renders from — so a component registered once
  // works in the chat and on a custom surface without registering twice.
  const toolRenderers = useRenderToolRegistry();
  const { executingToolCallIds } = useCopilotKit();

  return useCallback(
    ({ toolCall, toolMessage }: RenderToolCallInput) => {
      const renderer = toolRenderers.get(toolCall.function.name);
      if (!renderer) return null;

      const raw = toolCall.function.arguments || "{}";
      const args = partialJSONParse(raw);

      // Incomplete JSON means the model is still writing this call.
      let argsComplete = true;
      try {
        JSON.parse(raw);
      } catch {
        argsComplete = false;
      }

      const status = !argsComplete
        ? "inProgress"
        : toolMessage !== undefined
          ? "complete"
          : executingToolCallIds?.has(toolCall.id)
            ? "executing"
            : "complete";

      return renderer({ args, status, result: toolMessage?.content });
    },
    [toolRenderers, executingToolCallIds],
  );
}
