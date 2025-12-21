import { AbstractAgent, RunAgentInput, EventType, BaseEvent, ToolCallResultEvent } from "@ag-ui/client";
import { Observable } from "rxjs";

export class SlowToolCallStreamingAgent extends AbstractAgent {
  private delay = 200; // 0.2 seconds delay between chunks

  constructor(delayMs: number = 200) {
    super();
    this.delay = delayMs;
  }

  clone(): SlowToolCallStreamingAgent {
    return new SlowToolCallStreamingAgent(this.delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      let cancelled = false;

      const runAsync = async () => {
        await this.sleep(1000);
        try {
          const messageId = Date.now().toString();
          const toolCallId = `call_${Date.now()}`;

          // Start the run
          observer.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent);

          // Stream the initial text message
          const textMessage = "I'll check the weather for you. Let me fetch that information ok?.";
          const chunks = textMessage.split(" ");

          for (let i = 0; i < chunks.length; i++) {
            if (cancelled) return;
            observer.next({
              type: EventType.TEXT_MESSAGE_CHUNK,
              messageId,
              delta: (i > 0 ? " " : "") + chunks[i],
            } as BaseEvent);
            await this.sleep(this.delay);
          }

          // Stream the tool call
          const toolCallArgs = JSON.stringify({
            location: "San Francisco",
            unit: "celsius",
          });
          const toolCallChunks: string[] = [];
          for (let i = 0; i < toolCallArgs.length; i += 5) {
            toolCallChunks.push(toolCallArgs.slice(i, i + 5));
          }

          for (let i = 0; i < toolCallChunks.length; i++) {
            if (cancelled) return;
            if (i === 0) {
              // First chunk includes tool name
              observer.next({
                type: EventType.TOOL_CALL_CHUNK,
                toolCallId,
                toolCallName: "getWeather",
                parentMessageId: messageId,
                delta: toolCallChunks[0],
              } as BaseEvent);
            } else {
              // Subsequent chunks only include arguments
              observer.next({
                type: EventType.TOOL_CALL_CHUNK,
                toolCallId,
                parentMessageId: messageId,
                delta: toolCallChunks[i],
              } as BaseEvent);
            }
            await this.sleep(this.delay);
          }

          // Send tool result
          if (cancelled) return;
          const toolResultMessageId = `${Date.now()}_tool_result`;
          observer.next({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId,
            content: JSON.stringify({
              temperature: 18,
              unit: "celsius",
              condition: "partly cloudy",
              humidity: 65,
              windSpeed: 12,
            }),
            messageId: toolResultMessageId,
          } as ToolCallResultEvent);

          // Complete the run
          if (cancelled) return;
          observer.next({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent);
          observer.complete();
        } catch (error) {
          if (!cancelled) {
            observer.next({
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : "Unknown error occurred",
            } as BaseEvent);
            observer.error(error);
          }
        }
      };

      runAsync();

      // Cleanup function
      return () => {
        cancelled = true;
      };
    });
  }
}
