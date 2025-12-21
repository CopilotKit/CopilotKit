import { CopilotKitLowLevelError, isStructuredCopilotKitError } from "@copilotkit/shared";
import { catchError, mergeMap, ReplaySubject, scan } from "rxjs";
import { generateHelpfulErrorMessage } from "../../lib/streaming";
import {
  RuntimeEvent,
  RuntimeEventTypes,
  RuntimeMetaEventName,
} from "../../service-adapters/events";
import { CustomEventNames, LangGraphEvent, LangGraphEventTypes } from "./events";

interface LangGraphEventWithState {
  event: LangGraphEvent | null;

  isMessageStart: boolean;
  isMessageEnd: boolean;
  isToolCallStart: boolean;
  isToolCallEnd: boolean;
  isToolCall: boolean;

  lastMessageId: string | null;
  lastToolCallId: string | null;
  lastToolCallName: string | null;
  currentContent: string | null;
  processedToolCallIds: Set<string>;
}

export class RemoteLangGraphEventSource {
  public eventStream$ = new ReplaySubject<LangGraphEvent>();

  private shouldEmitToolCall(
    shouldEmitToolCalls: string | string[] | boolean,
    toolCallName: string,
  ) {
    if (typeof shouldEmitToolCalls === "boolean") {
      return shouldEmitToolCalls;
    }
    if (Array.isArray(shouldEmitToolCalls)) {
      return shouldEmitToolCalls.includes(toolCallName);
    }
    return shouldEmitToolCalls === toolCallName;
  }

  private getCurrentContent(event: LangGraphEvent) {
    // @ts-expect-error -- LangGraph Platform implementation stores data outside of kwargs
    const content = event.data?.chunk?.kwargs?.content ?? event.data?.chunk?.content;

    if (!content) {
      const toolCallChunks = this.getCurrentToolCallChunks(event) ?? [];
      for (const chunk of toolCallChunks) {
        if (chunk.args) {
          return chunk.args;
        }
      }
    }

    if (typeof content === "string") {
      return content;
    } else if (Array.isArray(content) && content.length > 0) {
      return content[0].text;
    }

    return null;
  }

  private getCurrentMessageId(event: LangGraphEvent) {
    // @ts-expect-error -- LangGraph Platform implementation stores data outside of kwargs
    return event.data?.chunk?.kwargs?.id ?? event.data?.chunk?.id;
  }

  private getCurrentToolCallChunks(event: LangGraphEvent) {
    // @ts-expect-error -- LangGraph Platform implementation stores data outside of kwargs
    return event.data?.chunk?.kwargs?.tool_call_chunks ?? event.data?.chunk?.tool_call_chunks;
  }

  private getResponseMetadata(event: LangGraphEvent) {
    // @ts-expect-error -- LangGraph Platform implementation stores data outside of kwargs
    return event.data?.chunk?.kwargs?.response_metadata ?? event.data?.chunk?.response_metadata;
  }

  processLangGraphEvents() {
    let lastEventWithState: LangGraphEventWithState | null = null;

    return this.eventStream$.pipe(
      scan(
        (acc, event) => {
          if (event.event === LangGraphEventTypes.OnChatModelStream) {
            const prevMessageId = acc.lastMessageId;
            acc.currentContent = this.getCurrentContent(event);
            acc.lastMessageId = this.getCurrentMessageId(event) ?? acc.lastMessageId;
            const toolCallChunks = this.getCurrentToolCallChunks(event) ?? [];
            const responseMetadata = this.getResponseMetadata(event);
            // Check if a given event is a tool call
            const toolCallCheck = toolCallChunks && toolCallChunks.length > 0;
            let isToolCallEnd = responseMetadata?.finish_reason === "tool_calls";

            acc.isToolCallStart = toolCallChunks.some((chunk: any) => chunk.name && chunk.id);
            acc.isMessageStart = prevMessageId !== acc.lastMessageId && !acc.isToolCallStart;

            let previousRoundHadToolCall = acc.isToolCall;
            acc.isToolCall = toolCallCheck;
            // Previous "acc.isToolCall" was set but now it won't pass the check, it means the tool call just ended.
            if (previousRoundHadToolCall && !toolCallCheck) {
              isToolCallEnd = true;
            }
            acc.isToolCallEnd = isToolCallEnd;
            acc.isMessageEnd = responseMetadata?.finish_reason === "stop";
            ({ name: acc.lastToolCallName, id: acc.lastToolCallId } = toolCallChunks.find(
              (chunk: any) => chunk.name && chunk.id,
            ) ?? { name: acc.lastToolCallName, id: acc.lastToolCallId });
          }
          acc.event = event;
          lastEventWithState = acc; // Capture the state
          return acc;
        },
        {
          event: null,
          isMessageStart: false,
          isMessageEnd: false,
          isToolCallStart: false,
          isToolCallEnd: false,
          isToolCall: false,
          lastMessageId: null,
          lastToolCallId: null,
          lastToolCallName: null,
          currentContent: null,
          processedToolCallIds: new Set<string>(),
        } as LangGraphEventWithState,
      ),
      mergeMap((acc): RuntimeEvent[] => {
        const events: RuntimeEvent[] = [];

        let shouldEmitMessages = true;
        let shouldEmitToolCalls: string | string[] | boolean = true;

        if (acc.event.event == LangGraphEventTypes.OnChatModelStream) {
          if ("copilotkit:emit-tool-calls" in (acc.event.metadata || {})) {
            shouldEmitToolCalls = acc.event.metadata["copilotkit:emit-tool-calls"];
          }
          if ("copilotkit:emit-messages" in (acc.event.metadata || {})) {
            shouldEmitMessages = acc.event.metadata["copilotkit:emit-messages"];
          }
        }

        if (acc.event.event === LangGraphEventTypes.OnInterrupt) {
          events.push({
            type: RuntimeEventTypes.MetaEvent,
            name: RuntimeMetaEventName.LangGraphInterruptEvent,
            value: acc.event.value,
          });
        }
        if (acc.event.event === LangGraphEventTypes.OnCopilotKitInterrupt) {
          events.push({
            type: RuntimeEventTypes.MetaEvent,
            name: RuntimeMetaEventName.CopilotKitLangGraphInterruptEvent,
            data: acc.event.data,
          });
        }

        // Handle CopilotKit error events with preserved semantic information
        if (acc.event.event === LangGraphEventTypes.OnCopilotKitError) {
          const errorData = acc.event.data.error;

          // Create a structured error with the original semantic information
          const preservedError = new CopilotKitLowLevelError({
            error: new Error(errorData.message),
            url: "langgraph agent",
            message: `${errorData.type}: ${errorData.message}`,
          });

          // Add additional error context to the error object
          if (errorData.status_code) {
            (preservedError as any).statusCode = errorData.status_code;
          }
          if (errorData.response_data) {
            (preservedError as any).responseData = errorData.response_data;
          }
          (preservedError as any).agentName = errorData.agent_name;
          (preservedError as any).originalErrorType = errorData.type;

          // Throw the structured error to be handled by the catchError operator
          throw preservedError;
        }

        const responseMetadata = this.getResponseMetadata(acc.event);

        // Tool call ended: emit ActionExecutionEnd
        if (
          acc.isToolCallEnd &&
          this.shouldEmitToolCall(shouldEmitToolCalls, acc.lastToolCallName) &&
          acc.lastToolCallId &&
          !acc.processedToolCallIds.has(acc.lastToolCallId)
        ) {
          acc.processedToolCallIds.add(acc.lastToolCallId);

          events.push({
            type: RuntimeEventTypes.ActionExecutionEnd,
            actionExecutionId: acc.lastToolCallId,
          });
        }

        // Message ended: emit TextMessageEnd
        else if (responseMetadata?.finish_reason === "stop" && shouldEmitMessages) {
          events.push({
            type: RuntimeEventTypes.TextMessageEnd,
            messageId: acc.lastMessageId,
          });
        }

        switch (acc.event!.event) {
          //
          // Custom events
          //
          case LangGraphEventTypes.OnCustomEvent:
            //
            // Manually emit a message
            //
            if (acc.event.name === CustomEventNames.CopilotKitManuallyEmitMessage) {
              events.push({
                type: RuntimeEventTypes.TextMessageStart,
                messageId: acc.event.data.message_id,
              });
              events.push({
                type: RuntimeEventTypes.TextMessageContent,
                messageId: acc.event.data.message_id,
                content: acc.event.data.message,
              });
              events.push({
                type: RuntimeEventTypes.TextMessageEnd,
                messageId: acc.event.data.message_id,
              });
            }
            //
            // Manually emit a tool call
            //
            else if (acc.event.name === CustomEventNames.CopilotKitManuallyEmitToolCall) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionStart,
                actionExecutionId: acc.event.data.id,
                actionName: acc.event.data.name,
                parentMessageId: acc.event.data.id,
              });
              events.push({
                type: RuntimeEventTypes.ActionExecutionArgs,
                actionExecutionId: acc.event.data.id,
                args: JSON.stringify(acc.event.data.args),
              });
              events.push({
                type: RuntimeEventTypes.ActionExecutionEnd,
                actionExecutionId: acc.event.data.id,
              });
            }
            break;
          case LangGraphEventTypes.OnCopilotKitStateSync:
            events.push({
              type: RuntimeEventTypes.AgentStateMessage,
              threadId: acc.event.thread_id,
              role: acc.event.role,
              agentName: acc.event.agent_name,
              nodeName: acc.event.node_name,
              runId: acc.event.run_id,
              active: acc.event.active,
              state: JSON.stringify(acc.event.state),
              running: acc.event.running,
            });
            break;
          case LangGraphEventTypes.OnChatModelStream:
            if (
              acc.isToolCallStart &&
              this.shouldEmitToolCall(shouldEmitToolCalls, acc.lastToolCallName)
            ) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionStart,
                actionExecutionId: acc.lastToolCallId,
                actionName: acc.lastToolCallName,
                parentMessageId: acc.lastMessageId,
              });
            }
            // Message started: emit TextMessageStart
            else if (acc.isMessageStart && shouldEmitMessages) {
              acc.processedToolCallIds.clear();
              events.push({
                type: RuntimeEventTypes.TextMessageStart,
                messageId: acc.lastMessageId,
              });
            }

            // Tool call args: emit ActionExecutionArgs
            if (
              acc.isToolCall &&
              acc.currentContent &&
              this.shouldEmitToolCall(shouldEmitToolCalls, acc.lastToolCallName)
            ) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionArgs,
                actionExecutionId: acc.lastToolCallId,
                args: acc.currentContent,
              });
            }
            // Message content: emit TextMessageContent
            else if (!acc.isToolCall && acc.currentContent && shouldEmitMessages) {
              events.push({
                type: RuntimeEventTypes.TextMessageContent,
                messageId: acc.lastMessageId,
                content: acc.currentContent,
              });
            }
            break;
        }
        return events;
      }),
      catchError((error) => {
        // If it's a structured CopilotKitError, re-throw it to be handled by the frontend error system
        if (isStructuredCopilotKitError(error)) {
          throw error;
        }

        // Determine a more helpful error message based on context
        let helpfulMessage = generateHelpfulErrorMessage(error, "LangGraph agent connection");

        // For all other errors, preserve the raw error information in a structured format
        throw new CopilotKitLowLevelError({
          error: error instanceof Error ? error : new Error(String(error)),
          url: "langgraph event stream",
          message: helpfulMessage,
        });
      }),
    );
  }
}
