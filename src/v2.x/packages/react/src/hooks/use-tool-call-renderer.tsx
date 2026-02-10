import React, { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkitnext/core";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "@/providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { partialJSONParse } from "@copilotkitnext/shared";
import { ReactToolCallRenderer } from "@/types/react-tool-call-renderer";

/**
 * Options for the useToolCallRenderer hook.
 */
export interface UseToolCallRendererOptions {
  /**
   * Optional array of messages to automatically find toolMessage for each tool call.
   * When provided, you can call renderToolCall(toolCall) instead of
   * renderToolCall({ toolCall, toolMessage }).
   */
  messages?: Message[];
}

/**
 * Return type for the useToolCallRenderer hook.
 */
export interface UseToolCallRendererResult {
  /**
   * Render a single tool call. Supports both new and legacy signatures.
   */
  renderToolCall: (input: RenderToolCallInput) => React.ReactElement | null;
  /**
   * Render a list of tool calls using renderToolCall.
   */
  renderAllToolCalls: (toolCalls?: ToolCall[] | null) => Array<React.ReactElement | null> | null;
}

/**
 * @deprecated Use the new API: `renderToolCall(toolCall)` with messages passed to the hook options.
 */
export interface UseToolCallRendererProps {
  toolCall: ToolCall;
  toolMessage?: ToolMessage;
}

/**
 * Input type for renderToolCall - supports both new and legacy signatures.
 * - New API: Pass a ToolCall directly (requires messages in hook options)
 * - Legacy API: Pass an object with toolCall and optional toolMessage
 */
export type RenderToolCallInput = ToolCall | { toolCall: ToolCall; toolMessage?: ToolMessage };

/**
 * Props for the memoized MemoizedToolCallRenderer component
 */
interface MemoizedToolCallRendererProps {
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
const MemoizedToolCallRenderer = React.memo(
  function MemoizedToolCallRenderer({
    toolCall,
    toolMessage,
    RenderComponent,
    isExecuting,
  }: MemoizedToolCallRendererProps) {
    // Memoize args based on the arguments string to maintain stable reference
    const args = useMemo(() => partialJSONParse(toolCall.function.arguments), [toolCall.function.arguments]);

    const toolName = toolCall.function.name;

    // Render based on status to preserve discriminated union type inference
    if (toolMessage) {
      return (
        <RenderComponent name={toolName} args={args} status={ToolCallStatus.Complete} result={toolMessage.content} />
      );
    } else if (isExecuting) {
      return <RenderComponent name={toolName} args={args} status={ToolCallStatus.Executing} result={undefined} />;
    } else {
      return <RenderComponent name={toolName} args={args} status={ToolCallStatus.InProgress} result={undefined} />;
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
  },
);

/**
 * Hook that returns helper functions to render tool calls based on the render functions
 * defined in CopilotKitProvider.
 *
 * @param options - Optional configuration including messages array for auto-finding toolMessage
 * @returns An object with functions to render one or many tool calls
 *
 * @example
 * // New API - pass messages to hook, call with just the tool call
 * const { renderToolCall } = useToolCallRenderer({ messages });
 * renderToolCall(toolCall);
 *
 * @example
 * // Legacy API - manually find and pass toolMessage
 * const { renderToolCall } = useToolCallRenderer();
 * const toolMessage = messages.find((m) => m.role === "tool" && m.toolCallId === toolCall.id);
 * renderToolCall({ toolCall, toolMessage });
 */
export function useToolCallRenderer(options?: UseToolCallRendererOptions): UseToolCallRendererResult {
  const { copilotkit, executingToolCallIds } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const agentId = config?.agentId ?? DEFAULT_AGENT_ID;

  // Store messages in a ref so changes don't recreate the callback.
  // The MemoizedToolCallRenderer's custom comparison handles preventing
  // re-renders when toolMessage.content hasn't changed.
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = options?.messages ?? [];

  // Subscribe to tool call renderers changes using useSyncExternalStore
  // This ensures we always have the latest value, even if subscriptions run in any order
  const toolCallRenderers = useSyncExternalStore(
    (callback) => {
      return copilotkit.subscribe({
        onToolCallRenderersChanged: callback,
      }).unsubscribe;
    },
    () => copilotkit.toolCallRenderers,
    () => copilotkit.toolCallRenderers,
  );

  // Note: executingToolCallIds is now provided by CopilotKitProvider context.
  // This is critical for HITL reconnection: when connecting to a thread with
  // pending tool calls, the onToolExecutionStart event fires before child components
  // mount. By tracking at the provider level, the executing state is already
  // available when this hook first runs.

  const renderToolCall = useCallback(
    (input: RenderToolCallInput): React.ReactElement | null => {
      // Normalize input to support both new and legacy signatures
      // New API: input is a ToolCall (has 'id' and 'function' properties)
      // Legacy API: input is { toolCall, toolMessage? }
      const isToolCall = "id" in input && "function" in input;
      const toolCall = isToolCall ? input : input.toolCall;
      let toolMessage = isToolCall ? undefined : input.toolMessage;

      // Auto-find toolMessage from ref if not provided
      if (!toolMessage && messagesRef.current.length > 0) {
        toolMessage = messagesRef.current.find((m) => m.role === "tool" && m.toolCallId === toolCall.id) as
          | ToolMessage
          | undefined;
      }
      // Find the render config for this tool call by name
      // For rendering, we show all tool calls regardless of agentId
      // The agentId scoping only affects handler execution (in core)
      // Priority order:
      // 1. Exact match by name (prefer agent-specific if multiple exist)
      // 2. Wildcard (*) renderer
      const exactMatches = toolCallRenderers.filter((rc) => rc.name === toolCall.function.name);

      // If multiple renderers with same name exist, prefer the one matching our agentId
      const renderConfig =
        exactMatches.find((rc) => rc.agentId === agentId) ||
        exactMatches.find((rc) => !rc.agentId) ||
        exactMatches[0] ||
        toolCallRenderers.find((rc) => rc.name === "*");

      if (!renderConfig) {
        return null;
      }

      const RenderComponent = renderConfig.render;
      const isExecuting = executingToolCallIds.has(toolCall.id);

      // Use the memoized MemoizedToolCallRenderer component to prevent unnecessary re-renders
      return (
        <MemoizedToolCallRenderer
          key={toolCall.id}
          toolCall={toolCall}
          toolMessage={toolMessage}
          RenderComponent={RenderComponent}
          isExecuting={isExecuting}
        />
      );
    },
    [toolCallRenderers, executingToolCallIds, agentId],
  );

  const renderAllToolCalls = useCallback<UseToolCallRendererResult["renderAllToolCalls"]>(
    (toolCalls) => {
      if (!toolCalls?.length) {
        return null;
      }

      return toolCalls.map((toolCall) => renderToolCall(toolCall));
    },
    [renderToolCall],
  );

  return useMemo(
    () => ({
      renderToolCall,
      renderAllToolCalls,
    }),
    [renderToolCall, renderAllToolCalls],
  );
}
