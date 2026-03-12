import {
  BaseEvent,
  EventType,
  RunAgentInput,
  RunErrorEvent,
} from "@ag-ui/client";
import { catchError, EMPTY, from, Observable, of, switchMap, tap } from "rxjs";

export function kickOffFlow(
  flowUrl: string,
  apiKey: string,
  webhookUrl: string,
  realtime: boolean,
  input: RunAgentInput
): Observable<BaseEvent> {
  const mostRecentMessage = input.messages[input.messages.length - 1];

  console.log(
    "Kicking off flow",
    JSON.stringify(
      {
        ...input,
        ...(input.state?.id ? { id: input.state.id } : {}),
        messages: [
          {
            content: mostRecentMessage.content,
            role: "user",
          },
        ],
      },
      null,
      2
    )
  );

  return from(
    fetch(`${flowUrl}/kickoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        inputs: {
          ...input,
          ...(input.state?.id ? { id: input.state.id } : {}),
          messages: [
            {
              content: mostRecentMessage.content,
              role: "user",
            },
          ],
        },
        flow_finished_webhook_url: `${webhookUrl}/${input.runId}`,
        webhooks: {
          events: ["*"],
          url: `${webhookUrl}/${input.runId}`,
          realtime: realtime || false,
          authentication: {
            strategy: "bearer",
            // no need since we don't force authentication
            token: "no_token_required",
          },
        },
      }),
    })
  ).pipe(
    switchMap((response) => {
      if (!response.ok) {
        console.error(
          `Flow kickoff failed: ${response.status} ${response.statusText}`
        );
        return response.text().then((errorText) => {
          throw new Error(
            `Flow kickoff failed: ${response.status} ${response.statusText}\n${errorText}`
          );
        });
      }
      return from(response.json()).pipe(
        tap((data) => console.log("Flow kicked off successfully", data)),
        switchMap(() => EMPTY)
      );
    }),
    catchError((error) => {
      console.error("Error kicking off flow:", error);
      return of({
        type: EventType.RUN_ERROR,
        message: `Failed to start flow: ${error.message}`,
        runId: input.runId,
        threadId: input.threadId,
        error: error.message,
      } as RunErrorEvent);
    })
  );
}
