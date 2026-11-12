import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ToolCall, ToolMessage } from "@ag-ui/core";
import {
  ɵbuildToolCallRenderProps,
  ɵdescribeUnrenderedToolCalls,
  ɵgetToolCallRendererNames,
  ɵresolveToolCallAgentId,
  ɵresolveToolCallRenderer,
} from "@copilotkit/core";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
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
  RenderComponent: ReactToolCallRenderer["render"];
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
    // Rebuild only when the call, its result, or its executing state changes,
    // so `args` keeps a stable reference across unrelated renders.
    const props = useMemo(
      () => ɵbuildToolCallRenderProps(toolCall, toolMessage, { isExecuting }),
      [toolCall, toolMessage, isExecuting],
    );
    return <RenderComponent {...props} />;
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
 * Reports tool calls that resolved to no renderer, once per tool name.
 *
 * A tool call with no renderer paints an empty message container and says
 * nothing else, so the only signal a developer gets today is a blank space in
 * the chat.
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
  const fresh = toolNames.filter((name) => !alreadyWarned.has(name));
  const warnings = ɵdescribeUnrenderedToolCalls(fresh, registered);
  for (const { toolName, message } of warnings) {
    alreadyWarned.add(toolName);
    console.warn(message);
  }
}

/**
 * The tool-call renderers registered on the provider, kept current.
 * @internal
 */
export function useToolCallRenderers() {
  const { copilotkit } = useCopilotKit();
  // useSyncExternalStore so the value is current even if subscriptions run in
  // any order.
  return useSyncExternalStore(
    (callback) =>
      copilotkit.subscribe({ onRenderToolCallsChanged: callback }).unsubscribe,
    () => copilotkit.renderToolCalls,
    () => copilotkit.renderToolCalls,
  );
}

/**
 * Which tool names have a renderer of their own, whether a wildcard (`"*"`)
 * renderer is registered, and which of them opted into grouping.
 * @internal
 */
export function useToolCallRendererNames() {
  const renderers = useToolCallRenderers();
  return useMemo(() => ɵgetToolCallRendererNames(renderers), [renderers]);
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
  const agentId = ɵresolveToolCallAgentId(config?.agentId, undefined);

  // Development-only bookkeeping for the warning below. Collected during render
  // and reported afterwards, because the registry is not settled during render.
  const unrenderedToolNames = useRef<Set<string>>(new Set());
  const warnedToolNames = useRef<Set<string>>(new Set());

  const renderToolCalls = useToolCallRenderers();

  // `executingToolCallIds` mirrors core's set, which is filled from the first
  // `onToolExecutionStart`. A HITL call resumed on reconnect, before this
  // chat mounted, is therefore already executing on the first render.

  const renderToolCall = useCallback(
    ({
      toolCall,
      toolMessage,
    }: UseRenderToolCallProps): React.ReactElement | null => {
      // Rendering shows tool calls from every agent: agentId scoping only
      // affects handler execution (in core). The lookup prefers this agent's
      // renderer, then an unscoped one, then any agent's, then a wildcard.
      const renderConfig = ɵresolveToolCallRenderer(
        renderToolCalls,
        toolCall.function.name,
        agentId,
      );

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

      const isExecuting = executingToolCallIds.has(toolCall.id);

      // Use the memoized ToolCallRenderer component to prevent unnecessary re-renders
      return (
        <ToolCallRenderer
          key={toolCall.id}
          toolCall={toolCall}
          toolMessage={toolMessage}
          RenderComponent={renderConfig.render}
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
