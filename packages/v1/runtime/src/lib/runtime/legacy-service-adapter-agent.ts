import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunAgentInput,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  RunFinishedEvent,
  RunErrorEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { CopilotServiceAdapter } from "../../service-adapters";
import {
  RuntimeEventSource,
  RuntimeEventSubject,
  RuntimeEventTypes,
  RuntimeEvent,
  EventSourceCallback,
} from "../../service-adapters/events";
import { aguiToGQL } from "../../graphql/message-conversion/agui-to-gql";
import { Message } from "../../graphql/types/converted";
import { ActionInput } from "../../graphql/inputs/action.input";

class InterceptingRuntimeEventSource extends RuntimeEventSource {
  constructor(private onStream: (callback: EventSourceCallback) => void) {
    super();
  }

  async stream(callback: EventSourceCallback): Promise<void> {
    this.onStream(callback);
    return super.stream(callback);
  }
}

export class LegacyServiceAdapterAgent extends AbstractAgent {
  constructor(private serviceAdapter: CopilotServiceAdapter) {
    super({
      agentId: serviceAdapter.name || "legacy-service-adapter",
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const eventStream$ = new RuntimeEventSubject();

      // Subscribe to the legacy event stream and forward to the agent subscriber
      const subscription = eventStream$.subscribe({
        next: (event: RuntimeEvent) => {
          try {
            const aguiEvent = this.mapRuntimeEventToAGUIEvent(
              event,
              input.threadId,
              input.runId
            );
            if (aguiEvent) {
              subscriber.next(aguiEvent);
            }
          } catch (error) {
            console.error("Error mapping legacy event:", error);
          }
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

      const eventSource = new InterceptingRuntimeEventSource(
        async (callback) => {
          try {
            await callback(eventStream$);
            // Ensure we close the stream when the callback finishes if it hasn't already
            if (!eventStream$.closed) {
              eventStream$.complete();
            }
          } catch (error) {
            eventStream$.error(error);
          }
        }
      );

      // Convert AGUI messages to Legacy GraphQL messages
      // aguiToGQL returns an array of messages
      const messages = aguiToGQL(input.messages) as Message[];

      // Convert tools to ActionInput[]
      // Note: This is a simplification. Deep conversion might be needed if structure differs significantly.
      // However, for LangChainAdapter, actions are usually mapped back to tools internally or ignored if using chainFn binding.
      const actions: ActionInput[] = input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        jsonSchema: JSON.stringify(tool.parameters),
      }));

      // Execute the adapter process
      this.serviceAdapter
        .process({
          eventSource,
          messages,
          actions,
          threadId: input.threadId,
          runId: input.runId,
          forwardedParameters: input.forwardedProps as any,
        })
        .then(() => {
          // Process completed successfully
          // Note: The stream callback handles the actual completion of the event stream
        })
        .catch((error) => {
          subscriber.error(error);
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  private mapRuntimeEventToAGUIEvent(
    event: RuntimeEvent,
    threadId: string,
    runId: string
  ): BaseEvent | null {
    switch (event.type) {
      case RuntimeEventTypes.TextMessageStart:
        return {
          type: EventType.TEXT_MESSAGE_START,
          messageId: event.messageId,
          role: "assistant",
        } as TextMessageStartEvent;

      case RuntimeEventTypes.TextMessageContent:
        return {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: event.messageId,
          delta: event.content,
        } as TextMessageContentEvent;

      case RuntimeEventTypes.TextMessageEnd:
        return {
          type: EventType.TEXT_MESSAGE_END,
          messageId: event.messageId,
        } as TextMessageEndEvent;

      case RuntimeEventTypes.ActionExecutionStart:
        return {
          type: EventType.TOOL_CALL_START,
          toolCallId: event.actionExecutionId,
          toolCallName: event.actionName,
        } as ToolCallStartEvent;

      case RuntimeEventTypes.ActionExecutionArgs:
        return {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: event.actionExecutionId,
          delta: event.args,
        } as ToolCallArgsEvent;

      case RuntimeEventTypes.ActionExecutionEnd:
        return {
          type: EventType.TOOL_CALL_END,
          toolCallId: event.actionExecutionId,
        } as ToolCallEndEvent;

      case RuntimeEventTypes.ActionExecutionResult:
        return {
          type: EventType.TOOL_CALL_RESULT,
          toolCallId: event.actionExecutionId,
          content: event.result,
        } as ToolCallResultEvent;

      case RuntimeEventTypes.RunError:
        return {
          type: EventType.RUN_ERROR,
          message: event.message,
          code: event.code,
        } as RunErrorEvent;

      // Ignore other events for now or map them if needed
      default:
        return null;
    }
  }
}
