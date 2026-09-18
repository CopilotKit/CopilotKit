import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ToolCall, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkit/core";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { partialJSONParse } from "@copilotkit/shared";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";

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
      [toolCall.function.arguments],
    );

    const toolName = toolCall.function.name;

    // Render based on status to preserve discriminated union type inference
    if (toolMessage) {
      return (
        <RenderComponent
          name={toolName}
          toolCallId={toolCall.id}
          args={args}
          status={ToolCallStatus.Complete}
          result={toolMessage.content}
        />
      );
    } else if (isExecuting) {
      return (
        <RenderComponent
          name={toolName}
          toolCallId={toolCall.id}
          args={args}
          status={ToolCallStatus.Executing}
          result={undefined}
        />
      );
    } else {
      return (
        <RenderComponent
          name={toolName}
          toolCallId={toolCall.id}
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
    if (prevProps.toolCall.function.name !== nextProps.toolCall.function.name)
      return false;
    if (
      prevProps.toolCall.function.arguments !==
      nextProps.toolCall.function.arguments
    )
      return false;

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

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

/**
 * Reports tool calls that resolved to no renderer.
 *
 * A tool call with no renderer paints an empty message container and says
 * nothing else, so the only signal a developer gets today is a blank space in
 * the chat. This names the call and the renderers that *are* registered, which
 * is the whole diagnosis when the cause is a name that does not match.
 *
 * @param toolNames - The unmatched tool names collected during render.
 * @param registered - The registry as it stands now, re-read at report time.
 * @param alreadyWarned - Names already reported, mutated to keep this once per name.
 */
function warnAboutUnrenderedToolCalls(
  toolNames: readonly string[],
  registered: readonly { readonly name: string }[],
  alreadyWarned: Set<string>,
): void {
  const registeredNames = Array.from(new Set(registered.map((rc) => rc.name)));
  const hasWildcard = registeredNames.includes("*");

  for (const toolName of toolNames) {
    // Re-check against the current registry: a renderer registered after the
    // render that recorded the miss makes the miss stale, not real.
    if (hasWildcard || registeredNames.includes(toolName)) continue;
    if (alreadyWarned.has(toolName)) continue;
    alreadyWarned.add(toolName);

    console.warn(
      `[CopilotKit] The agent called the tool "${toolName}", and no renderer is ` +
        `registered for it, so that message rendered nothing. ` +
        (registeredNames.length === 0
          ? "No tool-call renderers are registered. "
          : `Registered renderers: ${registeredNames.map((name) => `"${name}"`).join(", ")}. `) +
        `Register one with useRenderTool({ name: "${toolName}", ... }), or call ` +
        `useDefaultRenderTool() for a built-in card that covers every tool the ` +
        `agent calls. This warning is development-only.`,
    );
  }
}

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

  // Development-only bookkeeping for the warning below. Collected during render
  // and reported afterwards, because the registry is not settled during render.
  const unrenderedToolNames = useRef<Set<string>>(new Set());
  const warnedToolNames = useRef<Set<string>>(new Set());

  // Subscribe to render tool calls changes using useSyncExternalStore
  // This ensures we always have the latest value, even if subscriptions run in any order
  const renderToolCalls = useSyncExternalStore(
    (callback) => {
      return copilotkit.subscribe({
        onRenderToolCallsChanged: callback,
      }).unsubscribe;
    },
    () => copilotkit.renderToolCalls,
    () => copilotkit.renderToolCalls,
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
        (rc) => rc.name === toolCall.function.name,
      );

      // If multiple renderers with same name exist, prefer the one matching our agentId
      const renderConfig =
        exactMatches.find((rc) => rc.agentId === agentId) ||
        exactMatches.find((rc) => !rc.agentId) ||
        exactMatches[0] ||
        renderToolCalls.find((rc) => rc.name === "*");

      // No per-tool or wildcard renderer registered → render nothing.
      // Showing an unhandled tool call is opt-in: register a named/wildcard
      // renderer via useRenderTool, or call useDefaultRenderTool() for the
      // built-in card. Auto-painting a default card here would leak internal
      // tool names plus raw args/result JSON into every app's chat in
      // production, so the card must be explicitly enabled.
      if (!renderConfig) {
        if (IS_DEVELOPMENT) {
          unrenderedToolNames.current.add(toolCall.function.name);
        }
        return null;
      }

      const RenderComponent =
        renderConfig.render as ReactToolCallRenderer<unknown>["render"];
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
    [renderToolCalls, executingToolCallIds, agentId],
  );

  // Report unmatched tool calls after the commit that rendered them, deferred
  // one task past this subtree's effects. `useRenderTool` registers from an
  // effect in the component that renders the chat, and React runs child effects
  // before parent ones, so at effect time here a renderer the app does register
  // may not be in the registry yet. A timeout puts the check after every effect
  // in the tree, and `warnAboutUnrenderedToolCalls` re-reads the registry then.
  //
  // No dependency array on purpose: the misses live in a ref, so an effect that
  // only reran when `renderToolCalls` changed would never flush the common case
  // of a registry that never changes again.
  useEffect(() => {
    if (!IS_DEVELOPMENT) return;
    if (unrenderedToolNames.current.size === 0) return;

    const timer = setTimeout(() => {
      const pending = Array.from(unrenderedToolNames.current);
      unrenderedToolNames.current.clear();
      warnAboutUnrenderedToolCalls(
        pending,
        copilotkit.renderToolCalls,
        warnedToolNames.current,
      );
    }, 0);

    return () => clearTimeout(timer);
  });

  return renderToolCall;
}
