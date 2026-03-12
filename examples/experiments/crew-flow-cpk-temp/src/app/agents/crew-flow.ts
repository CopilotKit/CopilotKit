import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Role,
  RunAgentInput,
  RunFinishedEventSchema,
  RunStartedEventSchema,
  TextMessageContentEventSchema,
  TextMessageEndEventSchema,
  TextMessageStartEventSchema,
} from "@ag-ui/client";
import { finalize, Observable, of, switchMap, tap } from "rxjs";

// Define the webhook event type
interface WebhookEvent {
  type: string;
  data: any;
  timestamp: number;
}

export class CrewFlowsAgent extends AbstractAgent {
  description =
    "An AI agent specialized in collaborative book writing workflows, capable of coordinating multiple specialized agents to research, outline, draft, and refine book content through structured, intelligent task delegation";

  protected run(input: RunAgentInput): Observable<BaseEvent> {
    console.log(
      "CrewFlowsAgent input:",
      JSON.stringify(
        {
          threadId: input.threadId,
          runId: input.runId,
          messages: input.messages,
          context: input.context,
          tools: input.tools,
        },
        null,
        2
      )
    );

    return new Observable<BaseEvent>((observer) => {
      const messageId = Date.now().toString();
      const role: Role = "assistant";

      // Start the run
      observer.next(
        RunStartedEventSchema.parse({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        })
      );

      // Start text message
      observer.next(
        TextMessageStartEventSchema.parse({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role,
          timestamp: Date.now(),
        })
      );

      // Initiate webhook flow - first trigger kickoff then poll webhook until complete
      const subscription = of(null)
        .pipe(
          // First trigger the kickoff endpoint
          tap(() => console.log("Triggering kickoff endpoint...")),
          switchMap(() =>
            fetch("http://localhost:3000/api/crew-fake-kickoff", {
              method: "POST",
            }).then((res) => res.json())
          ),
          // Start polling the webhook
          switchMap(() => {
            // Initial call to webhook
            let currentType = "";

            // Return an observable that emits webhook events until completion
            return new Observable<WebhookEvent>((webhookObserver) => {
              const pollWebhook = () => {
                const url = new URL(
                  "http://localhost:3000/api/crew-fake-webhook"
                );
                if (currentType) {
                  url.searchParams.append("type", currentType);
                }

                fetch(url)
                  .then((res) => res.json())
                  .then((event: WebhookEvent) => {
                    currentType = event.type;
                    console.log(`Received webhook event: ${event.type}`);

                    // Format the event data as a markdown block
                    const eventText = `
### Event: ${event.type}
\`\`\`json
${JSON.stringify(event.data, null, 2)}
\`\`\`
`;

                    // Emit the event data as text content
                    observer.next(
                      TextMessageContentEventSchema.parse({
                        type: EventType.TEXT_MESSAGE_CONTENT,
                        messageId,
                        delta: eventText,
                        timestamp: Date.now(),
                      })
                    );

                    // Check if we've reached the completion event
                    if (event.type === "crew_execution_completed") {
                      webhookObserver.next(event);
                      webhookObserver.complete();
                    } else {
                      // Schedule the next poll with delay
                      setTimeout(pollWebhook, 1000);
                      webhookObserver.next(event);
                    }
                  })
                  .catch((err) => {
                    console.error("Error polling webhook:", err);
                    webhookObserver.error(err);
                  });
              };

              // Start polling
              pollWebhook();
            });
          }),
          finalize(() => {
            console.log("Finalizing webhook flow");

            // End the text message
            observer.next(
              TextMessageEndEventSchema.parse({
                type: EventType.TEXT_MESSAGE_END,
                messageId,
                timestamp: Date.now(),
              })
            );

            observer.next(
              RunFinishedEventSchema.parse({
                type: EventType.RUN_FINISHED,
                runId: input.runId,
                timestamp: Date.now(),
              })
            );

            observer.complete();
          })
        )
        .subscribe({
          next: (event: WebhookEvent) =>
            console.log("Webhook event processed:", event.type),
          error: (err) => {
            console.error("Error in webhook flow:", err);
            observer.error(err);
          },
          complete: () => console.log("Webhook flow complete"),
        });

      // Cleanup subscription when this observable is unsubscribed
      return () => {
        console.log("Cleaning up webhook subscription");
        subscription.unsubscribe();
      };
    });
  }
}
