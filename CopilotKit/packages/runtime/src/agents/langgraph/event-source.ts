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
              acc.toolCallId = event.data.chunk.kwargs.tool_call_chunks[0]?.id;
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

        // Tool call ended: emit ActionExecutionEnd
        if (
          eventWithState.prevToolCallId !== null &&
          eventWithState.prevToolCallId !== eventWithState.toolCallId
        ) {
          events.push({
            type: RuntimeEventTypes.ActionExecutionEnd,
          });
        }

        if (
          eventWithState.prevMessageId !== null &&
          eventWithState.prevMessageId !== eventWithState.messageId
        ) {
          events.push({
            type: RuntimeEventTypes.TextMessageEnd,
          });
        }

        switch (eventWithState.event!.event) {
          case LangGraphEventTypes.OnCopilotKitStateSync:
            events.push({
              type: RuntimeEventTypes.AgentStateMessage,
              threadId: eventWithState.event.thread_id,
              role: eventWithState.event.role,
              agentName: eventWithState.event.agent_name,
              nodeName: eventWithState.event.node_name,
              state: JSON.stringify(eventWithState.event.state),
              running: eventWithState.event.running,
            });
            break;
          case LangGraphEventTypes.OnToolEnd:
            const result = eventWithState.event.data?.output?.kwargs?.content?.[0];
            const toolCallId = eventWithState.event.data?.output?.kwargs?.tool_call_id;
            const toolCallName = eventWithState.event.data?.output?.kwargs?.name;
            if (result && toolCallId && toolCallName) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionResult,
                actionExecutionId: toolCallId,
                actionName: toolCallName,
                result,
              });
            }
            break;
          case LangGraphEventTypes.OnChatModelStream:
            if (
              eventWithState.toolCallId !== null &&
              eventWithState.prevToolCallId !== eventWithState.toolCallId
            ) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionStart,
                actionExecutionId: eventWithState.toolCallId,
                actionName: eventWithState.toolCallName,
                scope: "passThrough",
              });
            }
            // Message started: emit TextMessageStart
            else if (
              eventWithState.messageId !== null &&
              eventWithState.prevMessageId !== eventWithState.messageId
            ) {
              events.push({
                type: RuntimeEventTypes.TextMessageStart,
                messageId: eventWithState.messageId,
              });
            }

            const args = eventWithState.event.data?.chunk?.kwargs?.tool_call_chunks?.[0]?.args;
            const content = eventWithState.event.data?.chunk?.kwargs?.content;

            // Tool call args: emit ActionExecutionArgs
            if (eventWithState.toolCallId !== null && args) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionArgs,
                args,
              });
            }
            // Message content: emit TextMessageContent
            else if (eventWithState.messageId !== null && content) {
              events.push({
                type: RuntimeEventTypes.TextMessageContent,
                content,
              });
            }
            break;
        }
        return events;
      }),
    );
  }
}
