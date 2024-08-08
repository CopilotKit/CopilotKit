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
  state: any;
  running: boolean;
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

  getStateUpdate(event: LangGraphEvent) {
    if (event.event === LangGraphEventTypes.OnChainEnd) {
      let langSmithHidden = false;
      let isSeq = false;
      for (const tag of event.tags || []) {
        if (tag === "langsmith:hidden") {
          langSmithHidden = true;
        } else if (tag.startsWith("seq:step:")) {
          isSeq = true;
        }
      }
      if (event.data?.input && langSmithHidden && isSeq) {
        return event.data.input;
      }
    }
    return null;
  }

  isFinished(event: LangGraphEvent) {
    return event.event === LangGraphEventTypes.OnChainEnd && event.name === "LangGraph";
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

          if (this.isFinished(event)) {
            acc.running = false;
          }

          const stateUpdate = this.getStateUpdate(event);
          if (stateUpdate) {
            acc.state = stateUpdate;
          }

          acc.event = event;
          return acc;
        },
        {
          event: null,
          toolCallId: null,
          prevToolCallId: null,
          messageId: null,
          prevMessageId: null,
          running: true,
          state: null,
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

        switch (eventWithState.event!.event) {
          case LangGraphEventTypes.OnChainEnd:
            const isStateUpdate = this.getStateUpdate(eventWithState.event);

            if (isStateUpdate || this.isFinished(eventWithState.event)) {
              events.push({
                type: RuntimeEventTypes.AgentStateMessage,
                threadId: "",
                // agentName: "",
                // nodeName: "",
                state: JSON.stringify(eventWithState.state),
                running: eventWithState.running,
              });
            }
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
            // Tool call started: emit ActionExecutionStart
            if (
              eventWithState.toolCallId !== null &&
              eventWithState.prevToolCallId !== eventWithState.toolCallId
            ) {
              events.push({
                type: RuntimeEventTypes.ActionExecutionStart,
                actionExecutionId: eventWithState.toolCallId,
                actionName: eventWithState.toolCallName,
                scope: "server", // TODO: need an additional type for "transient" tool calls
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
