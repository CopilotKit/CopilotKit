import { ReplaySubject, scan, mergeMap, catchError } from "rxjs";
import { CustomEventNames, LangGraphEvent, LangGraphEventTypes } from "./events";
import { RuntimeEvent, RuntimeEventTypes } from "../../service-adapters/events";
import { randomId } from "@copilotkit/shared";

interface LangGraphEventWithState {
  event: LangGraphEvent | null;
  content: string | null;
  toolCallName: string | null;
  toolCallId: string | null;
  toolCallMessageId: string | null;
  prevToolCallMessageId: string | null;
  messageId: string | null;
  prevMessageId: string | null;
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

  processLangGraphEvents() {
    let lastEventWithState: LangGraphEventWithState | null = null;

    return this.eventStream$.pipe(
      scan(
        (acc, event) => {
          if (event.event === LangGraphEventTypes.OnChatModelStream) {
            // @ts-expect-error -- LangGraph Platform implementation stores data outside of kwargs
            const content = event.data?.chunk?.kwargs?.content ?? event.data?.chunk?.content;

            if (typeof content === "string") {
              acc.content = content;
            } else if (Array.isArray(content) && content.length > 0) {
              acc.content = content[0].text;
            } else {
              acc.content = null;
            }

            const toolCallChunks =
              // @ts-expect-error -- LangGraph Platform implementation stores data outside of kwargs
              event.data?.chunk?.kwargs?.tool_call_chunks ?? event.data?.chunk?.tool_call_chunks;

            const toolCallMessageId =
              event.data?.chunk?.kwargs?.id ??
              (event.data?.chunk?.id as unknown as string | undefined);

            if (toolCallChunks && toolCallChunks.length > 0) {
              acc.prevToolCallMessageId = acc.toolCallMessageId;
              acc.toolCallMessageId = toolCallMessageId;
              if (toolCallChunks[0]?.name) {
                acc.toolCallName = toolCallChunks[0].name;
              }
              if (toolCallChunks[0]?.id) {
                acc.toolCallId = toolCallChunks[0].id;
              }
              acc.prevMessageId = acc.messageId;
              acc.messageId = toolCallMessageId;
            } else if (acc.content && acc.content != "") {
              acc.prevMessageId = acc.messageId;
              acc.messageId = toolCallMessageId;
            } else {
              acc.prevToolCallMessageId = acc.toolCallMessageId;
              acc.prevMessageId = acc.messageId;
            }
          } else {
            acc.prevToolCallMessageId = acc.toolCallMessageId;
            acc.toolCallMessageId = null;
            acc.prevMessageId = acc.messageId;
            acc.messageId = null;
            acc.toolCallName = null;
          }

          acc.event = event;
          lastEventWithState = acc; // Capture the state
          return acc;
        },
        {
          event: null,
          toolCallId: null,
          toolCallMessageId: null,
          prevToolCallMessageId: null,
          messageId: null,
          toolCallName: null,
          prevMessageId: null,
          content: null,
        } as LangGraphEventWithState,
      ),
      mergeMap((eventWithState): RuntimeEvent[] => {
        const events: RuntimeEvent[] = [];

        let shouldEmitMessages = true;
        let shouldEmitToolCalls: string | string[] | boolean = false;

        if (eventWithState.event.event == LangGraphEventTypes.OnChatModelStream) {
          if ("copilotkit:emit-tool-calls" in (eventWithState.event.metadata || {})) {
            shouldEmitToolCalls = eventWithState.event.metadata["copilotkit:emit-tool-calls"];
          }
          if ("copilotkit:emit-messages" in (eventWithState.event.metadata || {})) {
            shouldEmitMessages = eventWithState.event.metadata["copilotkit:emit-messages"];
          }
        }

        // Tool call ended: emit ActionExecutionEnd
        if (
          eventWithState.prevToolCallMessageId !== null &&
          eventWithState.prevToolCallMessageId !== eventWithState.toolCallMessageId &&
          this.shouldEmitToolCall(shouldEmitToolCalls, eventWithState.toolCallName)
        ) {
          events.push({
            type: RuntimeEventTypes.ActionExecutionEnd,
          });
        }

        // Message ended: emit TextMessageEnd
        if (
          eventWithState.prevMessageId !== null &&
          eventWithState.prevMessageId !== eventWithState.messageId &&
          shouldEmitMessages
        ) {
          events.push({
            type: RuntimeEventTypes.TextMessageEnd,
          });
        }

        switch (eventWithState.event!.event) {
          //
          // Custom events
          //
          case LangGraphEventTypes.OnCustomEvent:
            //
            // Manually emit a message
            //
            if (eventWithState.event.name === CustomEventNames.CopilotKitManuallyEmitMessage) {
              events.push({
                type: RuntimeEventTypes.TextMessageStart,
                messageId: eventWithState.event.data.message_id,
              });
              events.push({
                type: RuntimeEventTypes.TextMessageContent,
                content: eventWithState.event.data.message,
              });
              events.push({
                type: RuntimeEventTypes.TextMessageEnd,
              });
            }
            //
            // Manually emit a tool call
            //
            else if (
              eventWithState.event.name === CustomEventNames.CopilotKitManuallyEmitToolCall
            ) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionStart,
                actionExecutionId: eventWithState.event.data.id,
                actionName: eventWithState.event.data.name,
              });
              events.push({
                type: RuntimeEventTypes.ActionExecutionArgs,
                args: JSON.stringify(eventWithState.event.data.args),
              });
              events.push({
                type: RuntimeEventTypes.ActionExecutionEnd,
              });
            }
            break;
          case LangGraphEventTypes.OnCopilotKitStateSync:
            events.push({
              type: RuntimeEventTypes.AgentStateMessage,
              threadId: eventWithState.event.thread_id,
              role: eventWithState.event.role,
              agentName: eventWithState.event.agent_name,
              nodeName: eventWithState.event.node_name,
              runId: eventWithState.event.run_id,
              active: eventWithState.event.active,
              state: JSON.stringify(eventWithState.event.state),
              running: eventWithState.event.running,
            });
            break;
          case LangGraphEventTypes.OnToolEnd:
            // TODO-AGENTS: emit ActionExecutionResult when needed
            // Need a special tool node for that?

            // const result = eventWithState.event.data?.output?.kwargs?.content?.[0];
            // const toolCallId = eventWithState.event.data?.output?.kwargs?.tool_call_id;
            // const toolCallName = eventWithState.event.data?.output?.kwargs?.name;
            // if (result && toolCallId && toolCallName) {
            //   events.push({
            //     type: RuntimeEventTypes.ActionExecutionResult,
            //     actionExecutionId: toolCallId,
            //     actionName: toolCallName,
            //     result,
            //   });
            // }
            break;
          case LangGraphEventTypes.OnChatModelStream:
            if (
              eventWithState.toolCallMessageId !== null &&
              eventWithState.prevToolCallMessageId !== eventWithState.toolCallMessageId
            ) {
              if (this.shouldEmitToolCall(shouldEmitToolCalls, eventWithState.toolCallName)) {
                events.push({
                  type: RuntimeEventTypes.ActionExecutionStart,
                  actionExecutionId: eventWithState.toolCallMessageId,
                  actionName: eventWithState.toolCallName,
                });
              }
            }
            // Message started: emit TextMessageStart
            else if (
              eventWithState.messageId !== null &&
              eventWithState.prevMessageId !== eventWithState.messageId
            ) {
              if (shouldEmitMessages) {
                events.push({
                  type: RuntimeEventTypes.TextMessageStart,
                  messageId: eventWithState.messageId,
                });
              }
            }

            const args =
              eventWithState.event.data?.chunk?.kwargs?.tool_call_chunks?.[0]?.args ??
              // @ts-expect-error -- sdf
              eventWithState.event.data?.chunk?.tool_call_chunks?.[0]?.args;
            const content = eventWithState.content;

            // Tool call args: emit ActionExecutionArgs
            if (args) {
              if (this.shouldEmitToolCall(shouldEmitToolCalls, eventWithState.toolCallName)) {
                events.push({
                  type: RuntimeEventTypes.ActionExecutionArgs,
                  args,
                });
              }
            }
            // Message content: emit TextMessageContent
            else if (eventWithState.messageId !== null && content) {
              if (shouldEmitMessages) {
                events.push({
                  type: RuntimeEventTypes.TextMessageContent,
                  content,
                });
              }
            }
            break;
        }
        return events;
      }),
      catchError((error) => {
        console.error(error);
        const events: RuntimeEvent[] = [];

        if (lastEventWithState?.messageId) {
          events.push({
            type: RuntimeEventTypes.TextMessageEnd,
          });
        }
        if (lastEventWithState?.toolCallMessageId) {
          events.push({
            type: RuntimeEventTypes.ActionExecutionEnd,
          });
        }

        const messageId = randomId();

        events.push({
          type: RuntimeEventTypes.TextMessageStart,
          messageId: messageId,
        });
        events.push({
          type: RuntimeEventTypes.TextMessageContent,
          content: "❌ An error occurred. Please try again.",
        });
        events.push({
          type: RuntimeEventTypes.TextMessageEnd,
        });

        return events;
      }),
    );
  }
}
