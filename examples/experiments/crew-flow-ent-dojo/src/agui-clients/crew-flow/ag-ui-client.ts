import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageChunkEvent,
} from "@ag-ui/client";
import { concat, Observable, of } from "rxjs";
import { kickOffFlow } from "./kickoff-flow";
import { pollWebhookEvents } from "./poll-webhook-events";

export class CrewFlowAgUiClient extends AbstractAgent {
  description = "Crew Flow Agent";

  private flowUrl: string;
  private apiKey: string;
  private webhookUrl: string;
  private realtime: boolean;

  constructor(options: {
    flowUrl: string;
    apiKey: string;
    webhookUrl: string;
    realtime: boolean;
  }) {
    super();
    // Store configuration options
    this.flowUrl = options.flowUrl;
    this.apiKey = options.apiKey;
    this.webhookUrl = options.webhookUrl;
    this.realtime = options.realtime ?? false;
  }

  protected run(input: RunAgentInput): Observable<BaseEvent> {
    const kickoffMessageId = `kickoff-${Date.now().toString()}`;

    const mostRecentMessage = input.messages[input.messages.length - 1];

    const shouldKickoffFlow =
      input.messages.length > 0 && Boolean(mostRecentMessage?.content);

    if (!shouldKickoffFlow) {
      return concat(
        of({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunStartedEvent),
        of({
          type: EventType.TEXT_MESSAGE_CHUNK,
          role: "assistant",
          delta: "",
          messageId: kickoffMessageId,
        } as TextMessageChunkEvent),

        of({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunFinishedEvent)
      );
    }

    return concat(
      // First emit RUN_STARTED
      of({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as RunStartedEvent),

      // Kick off the flow and get a webhook ID
      kickOffFlow(
        this.flowUrl,
        this.apiKey,
        this.webhookUrl,
        this.realtime,
        input
      ),

      // Poll the webhook for events using the active input threadId
      pollWebhookEvents(
        `${this.webhookUrl}/${input.runId}/events`,
        kickoffMessageId,
        input
      ),

      // Finally emit RUN_FINISHED
      of({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as RunFinishedEvent)
    );
  }
}
