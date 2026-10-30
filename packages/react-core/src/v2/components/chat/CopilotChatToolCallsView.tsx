import React, {
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { useRenderToolCall } from "../../hooks";
import { useCopilotKit } from "../../context";
import { useToolCallRendererNames } from "../../hooks/use-render-tool-call";
import type { SlotValue } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import {
  Collapsible,
  CopilotChatToolCallGroup,
  ToolCallGroupContext,
} from "./CopilotChatToolCallGroup";
import type { CopilotChatToolCallGroupAppearance } from "./CopilotChatToolCallGroup";
import { ToolCallDisplayContext } from "./tool-call-display-context";
import { getToolCallLayouts, getToolResults } from "./tool-call-layout";
import type {
  CopilotChatToolCallDisplay,
  ToolCallEntry,
} from "./tool-call-layout";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
  /**
   * How to show the calls (see `CopilotChatToolCallDisplay`). Inside a message
   * view it follows the view's `toolCallDisplay`; on its own it defaults to
   * `"grouped"`.
   */
  display?: CopilotChatToolCallDisplay;
  /**
   * Draws a group of calls made in a row: a component, a class name for the
   * default group, or props for it (e.g. `{ appearance: "line" }`).
   */
  group?: SlotValue<typeof CopilotChatToolCallGroup>;
};

const appearances: Partial<
  Record<CopilotChatToolCallDisplay, CopilotChatToolCallGroupAppearance>
> = {
  grouped: "card",
  line: "line",
  stacked: "stack",
};

export function CopilotChatToolCallsView({
  message,
  messages = [],
  display: displayProp,
  group,
}: CopilotChatToolCallsViewProps) {
  const renderToolCall = useRenderToolCall();
  const rendererNames = useToolCallRendererNames();
  const { copilotkit } = useCopilotKit();
  const subscribe = useCallback(
    (onChange: () => void) =>
      copilotkit.ɵsubscribeToLearningConfigured(onChange),
    [copilotkit],
  );
  const getSnapshot = () => copilotkit.ɵlearningConfigured;
  // Driven by the learning config, not by the Trajectory: a wrapper that comes
  // and goes with capture state would remount the tool UI on every reconnect.
  // Only adding or removing the config itself changes the tree.
  const learningConfigured = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const context = useContext(ToolCallDisplayContext);
  const display = displayProp ?? context?.display ?? "grouped";

  // Inside a message view, groups can span messages, so the view lays them
  // out for the whole list; on its own, this message's calls are grouped.
  const viewLayout = context?.layouts.get(message.id);
  const layout = useMemo(() => {
    if (display === "separate") return undefined;
    return (
      viewLayout ??
      getToolCallLayouts([message], messages, rendererNames).get(message.id)
    );
  }, [display, viewLayout, message, messages, rendererNames]);

  if (!message.toolCalls || message.toolCalls.length === 0) {
    return null;
  }

  const renderCall = (entry: ToolCallEntry) => {
    const rendered = renderToolCall({
      toolCall: entry.toolCall,
      toolMessage: entry.toolMessage,
    });
    if (rendered === null || !learningConfigured) return rendered;
    // The id lets interaction capture attribute clicks to this tool call.
    return (
      <div
        data-tool-call-id={entry.toolCall.id}
        style={{ display: "contents" }}
      >
        {rendered}
      </div>
    );
  };

  if (!layout) {
    // Replayed history can hold both the transport placeholder and the saved
    // result for a call. Use the same index as the grouped layout so the
    // answer wins instead of the first message that mentions the call.
    const results = getToolResults(messages);
    return (
      <>
        {message.toolCalls.map((toolCall) => {
          const toolMessage = results.get(toolCall.id);
          return (
            <React.Fragment key={toolCall.id}>
              {renderCall({ toolCall, toolMessage })}
            </React.Fragment>
          );
        })}
      </>
    );
  }

  const workOpen = context?.workOpen.get(message.id);
  // Whether the agent may still finish a trailing group's calls. Without a
  // message view there's no run state, so a call with no result is assumed to
  // be running, as the built-in card has always shown it.
  const groupActive = (trailing: boolean) =>
    trailing && (context ? context.isRunning : true);

  return (
    <>
      {layout.segments.map((segment) => {
        if (segment.kind === "call") {
          return (
            <React.Fragment key={segment.id}>
              {renderCall(segment.call)}
            </React.Fragment>
          );
        }

        if (display === "turn") {
          // A row per call, in the open while the agent works; the message
          // view folds them away with the rest of the work once it's done.
          const failedIds = new Set(
            segment.calls
              .filter((call) => call.toolMessage?.error)
              .map((call) => call.toolCall.id),
          );
          return (
            <Collapsible
              key={segment.id}
              open={workOpen ?? true}
              className="cpk:-mx-2"
            >
              <div className="cpk:px-2 cpk:py-1.5">
                <ToolCallGroupContext.Provider
                  value={{
                    appearance: "line",
                    failedIds,
                    active: groupActive(segment.trailing),
                  }}
                >
                  {segment.calls.map((call) => (
                    <React.Fragment key={call.toolCall.id}>
                      {renderCall(call)}
                    </React.Fragment>
                  ))}
                </ToolCallGroupContext.Provider>
              </div>
            </Collapsible>
          );
        }

        return (
          <React.Fragment key={segment.id}>
            {renderSlot(group, CopilotChatToolCallGroup, {
              calls: segment.calls,
              renderCall,
              appearance: appearances[display] ?? "card",
              isActive: groupActive(segment.trailing),
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default CopilotChatToolCallsView;
