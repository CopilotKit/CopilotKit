import { ReplaySubject, scan, mergeMap } from "rxjs";
import { LangGraphEvent, LangGraphEventTypes } from "./events";
import { RuntimeEvent, RuntimeEventTypes } from "../../service-adapters/events";

interface LangGraphEventWithState {
  event: LangGraphEvent | null;
  toolCallName: string | null;
  toolCallId: string | null;
  prevToolCallId: string | null;
  messageId: string | null;
  prevMessageId: string | null;
}

export class RemoteLangGraphEventSource {
  private eventStream$ = new ReplaySubject<LangGraphEvent>();

  async streamResponse(response: Response) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = [];
    const eventStream$ = this.eventStream$;

    function flushBuffer() {
      const currentBuffer = buffer.join("");
      if (currentBuffer.trim().length === 0) {
        return;
      }
      const parts = currentBuffer.split("\n");
      if (parts.length === 0) {
        return;
      }

      const lastPartIsComplete = currentBuffer.endsWith("\n");

      // truncate buffer
      buffer = [];

      if (!lastPartIsComplete) {
        // put back the last part
        buffer.push(parts.pop());
      }

      parts
        .map((part) => part.trim())
        .filter((part) => part != "")
        .forEach((part) => {
          eventStream$.next(JSON.parse(part));
        });
    }

    while (true) {
      const { done, value } = await reader.read();

      if (!done) {
        buffer.push(decoder.decode(value, { stream: true }));
      }

      flushBuffer();

      if (done) {
        break;
      }
    }
    eventStream$.complete();
  }

  processLangGraphEvents() {
    return this.eventStream$.pipe(
      scan(
        (acc, event) => {
          if (event.event === LangGraphEventTypes.OnChatModelStream) {
            if (event.data?.chunk?.kwargs?.tool_call_chunks) {
              acc.prevToolCallId = acc.toolCallId;
              acc.toolCallId = event.data.chunk.kwargs?.id;
              if (event.data.chunk.kwargs.tool_call_chunks[0]?.name) {
                acc.toolCallName = event.data.chunk.kwargs.tool_call_chunks[0].name;
              }
            }
            acc.prevMessageId = acc.messageId;
            acc.messageId = event.data?.chunk?.kwargs?.id;
          } else {
            acc.prevToolCallId = acc.toolCallId;
            acc.toolCallId = null;
            acc.prevMessageId = acc.messageId;
            acc.messageId = null;
            acc.toolCallName = null;
          }

          acc.event = event;
          return acc;
        },
        {
          event: null,
          toolCallId: null,
          prevToolCallId: null,
          messageId: null,
          toolCallName: null,
          prevMessageId: null,
        } as LangGraphEventWithState,
      ),
      mergeMap((eventWithState): RuntimeEvent[] => {
        const events: RuntimeEvent[] = [];

        let shouldEmitMessages = true;
        let shouldEmitToolCalls = false;

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
          eventWithState.prevToolCallId !== null &&
          eventWithState.prevToolCallId !== eventWithState.toolCallId &&
          shouldEmitToolCalls
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
          case LangGraphEventTypes.OnCopilotKitEmitMessage:
            events.push({
              type: RuntimeEventTypes.TextMessageStart,
              messageId: eventWithState.event.message_id,
            });
            events.push({
              type: RuntimeEventTypes.TextMessageContent,
              content: eventWithState.event.message,
            });
            events.push({
              type: RuntimeEventTypes.TextMessageEnd,
            });
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
              eventWithState.toolCallId !== null &&
              eventWithState.prevToolCallId !== eventWithState.toolCallId
            ) {
              if (shouldEmitToolCalls) {
                events.push({
                  type: RuntimeEventTypes.ActionExecutionStart,
                  actionExecutionId: eventWithState.toolCallId,
                  actionName: eventWithState.toolCallName,
                  scope: "client",
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

            const args = eventWithState.event.data?.chunk?.kwargs?.tool_call_chunks?.[0]?.args;
            const content = eventWithState.event.data?.chunk?.kwargs?.content;

            // Tool call args: emit ActionExecutionArgs
            if (args) {
              if (shouldEmitToolCalls) {
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
    );
  }
}
