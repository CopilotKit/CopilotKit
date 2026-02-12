import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { ToolCall, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkitnext/core";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "@/providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { partialJSONParse } from "@copilotkitnext/shared";
import { ReactToolCallRenderer } from "@/types/react-tool-call-renderer";

export interface UseRenderToolCallProps {
  toolCall: ToolCall;
  toolMessage?: ToolMessage;
}

/**
 * Props for the memoized ToolCallRenderer component
 */
interface ToolCallRendererProps {
  toolCall: ToolCall;
  toolMessage?: ToolMessage;
  RenderComponent: ReactToolCallRenderer<unknown>["render"];
  isExecuting: boolean;
}

/**
 * Memoized component that renders a single tool call.
 * This prevents unnecessary re-renders when parent components update
 * but the tool call data hasn't changed.
 */
const ToolCallRenderer = React.memo(
  function ToolCallRenderer({
    toolCall,
    toolMessage,
    RenderComponent,
    isExecuting,
  }: ToolCallRendererProps) {
    // Memoize args based on the arguments string to maintain stable reference
    const args = useMemo(
      () => partialJSONParse(toolCall.function.arguments),
      [toolCall.function.arguments]
    );

    const toolName = toolCall.function.name;

    // Render based on status to preserve discriminated union type inference
    if (toolMessage) {
      return (
        <RenderComponent
          name={toolName}
          args={args}
          status={ToolCallStatus.Complete}
          result={toolMessage.content}
        />
      );
    } else if (isExecuting) {
      return (
        <RenderComponent
          name={toolName}
          args={args}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );
    } else {
      return (
        <RenderComponent
          name={toolName}
          args={args}
          status={ToolCallStatus.InProgress}
          result={undefined}
        />
      );
    }
  },
  // Custom comparison function to prevent re-renders when tool call data hasn't changed
  (prevProps, nextProps) => {
    // Compare tool call identity and content
    if (prevProps.toolCall.id !== nextProps.toolCall.id) return false;
    if (prevProps.toolCall.function.name !== nextProps.toolCall.function.name) return false;
    if (prevProps.toolCall.function.arguments !== nextProps.toolCall.function.arguments) return false;

    // Compare tool message (result)
    const prevResult = prevProps.toolMessage?.content;
    const nextResult = nextProps.toolMessage?.content;
    if (prevResult !== nextResult) return false;

    // Compare executing state
    if (prevProps.isExecuting !== nextProps.isExecuting) return false;

    // Compare render component reference
    if (prevProps.RenderComponent !== nextProps.RenderComponent) return false;

    return true;
  }
);

/**
 * Hook that returns a function to render tool calls based on the render functions
 * defined in CopilotKitProvider.
 *
 * @returns A function that takes a tool call and optional tool message and returns the rendered component
 */
export function useRenderToolCall() {
  const { copilotkit, executingToolCallIds } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const agentId = config?.agentId ?? DEFAULT_AGENT_ID;

  // Subscribe to render tool calls changes using useSyncExternalStore
  // This ensures we always have the latest value, even if subscriptions run in any order
  const renderToolCalls = useSyncExternalStore(
    (callback) => {
      return copilotkit.subscribe({
        onRenderToolCallsChanged: callback,
      }).unsubscribe;
    },
    () => copilotkit.renderToolCalls,
    () => copilotkit.renderToolCalls
  );

  // Note: executingToolCallIds is now provided by CopilotKitProvider context.
  // This is critical for HITL reconnection: when connecting to a thread with
  // pending tool calls, the onToolExecutionStart event fires before child components
  // mount. By tracking at the provider level, the executing state is already
  // available when this hook first runs.

  const renderToolCall = useCallback(
    ({
      toolCall,
      toolMessage,
    }: UseRenderToolCallProps): React.ReactElement | null => {
      // Find the render config for this tool call by name
      // For rendering, we show all tool calls regardless of agentId
      // The agentId scoping only affects handler execution (in core)
      // Priority order:
      // 1. Exact match by name (prefer agent-specific if multiple exist)
      // 2. Wildcard (*) renderer
      const exactMatches = renderToolCalls.filter(
        (rc) => rc.name === toolCall.function.name
      );

      // If multiple renderers with same name exist, prefer the one matching our agentId
      const renderConfig =
        exactMatches.find((rc) => rc.agentId === agentId) ||
        exactMatches.find((rc) => !rc.agentId) ||
        exactMatches[0] ||
        renderToolCalls.find((rc) => rc.name === "*");

      if (!renderConfig) {
        return null;
      }

      const RenderComponent = renderConfig.render;
      const isExecuting = executingToolCallIds.has(toolCall.id);

      // Use the memoized ToolCallRenderer component to prevent unnecessary re-renders
      return (
        <ToolCallRenderer
          key={toolCall.id}
          toolCall={toolCall}
          toolMessage={toolMessage}
          RenderComponent={RenderComponent}
          isExecuting={isExecuting}
        />
      );
    },
    [renderToolCalls, executingToolCallIds, agentId]
  );

  return renderToolCall;
}
