import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import {
  Subject,
  Subscription,
  finalize,
  firstValueFrom,
  shareReplay,
  skipWhile,
  take,
  takeWhile,
  tap,
} from "rxjs";
import { GenerateCopilotResponseInput } from "../inputs/generate-copilot-response.input";
import { CopilotResponse } from "../types/copilot-response.type";
import { MessageRole } from "../types/enums";
import { Repeater } from "graphql-yoga";
import type { CopilotRequestContextProperties, GraphQLContext } from "../../lib/integrations";
import { nanoid } from "nanoid";
import { RuntimeEvent, RuntimeEventTypes } from "../../service-adapters/events";
import {
  FailedMessageStatus,
  MessageStatusUnion,
  SuccessMessageStatus,
} from "../types/message-status.type";
import {
  FailedResponseStatus,
  ResponseStatusUnion,
  SuccessResponseStatus,
} from "../types/response-status.type";
import { GraphQLJSONObject } from "graphql-scalars";
import { plainToInstance } from "class-transformer";
import { GuardrailsResult } from "../types/guardrails-result.type";
import { GraphQLError } from "graphql";

const invokeGuardrails = async ({
  baseUrl,
  copilotCloudPublicApiKey,
  data,
  onResult,
}: {
  baseUrl: string;
  copilotCloudPublicApiKey: string;
  data: GenerateCopilotResponseInput;
  onResult: (result: GuardrailsResult) => void;
}) => {
  const lastUserTextMessageIndex = data.messages.reverse().findIndex((msg) => {
    if (msg.textMessage && msg.textMessage.role === MessageRole.user) {
      return msg;
    }
  });

  if (lastUserTextMessageIndex !== -1) {
    const lastMessage = data.messages[lastUserTextMessageIndex];
    const restOfMessages = data.messages.slice(0, lastUserTextMessageIndex);

    const body = {
      input: lastMessage.textMessage.content,
      validTopics: data.cloud.guardrails.inputValidationRules.allowList,
      invalidTopics: data.cloud.guardrails.inputValidationRules.denyList,
      messages: restOfMessages,
    };

    const guardrailsResult = await fetch(`${baseUrl}/guardrails/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CopilotCloud-Public-API-Key": copilotCloudPublicApiKey,
      },
      body: JSON.stringify(body),
    });

    const resultJson: GuardrailsResult = await guardrailsResult.json();
    onResult(resultJson);
  }
};

@Resolver(() => CopilotResponse)
export class CopilotResolver {
  @Query(() => String)
  async hello() {
    return "Hello World";
  }

  @Mutation(() => CopilotResponse)
  async generateCopilotResponse(
    @Ctx() ctx: GraphQLContext,
    @Arg("data") data: GenerateCopilotResponseInput,
    @Arg("properties", () => GraphQLJSONObject, { nullable: true })
    properties?: CopilotRequestContextProperties,
  ) {
    if (properties) {
      ctx._copilotkit.properties = { ...ctx._copilotkit.properties, ...properties };
    }

    let copilotCloudPublicApiKey: string | null = null;

    if (data.cloud) {
      const key = ctx.request.headers.get("x-copilotcloud-public-api-key");
      if (key) {
        copilotCloudPublicApiKey = key;
      } else {
        throw new GraphQLError("X-CopilotCloud-Public-API-Key header is required");
      }
    }

    const copilotRuntime = ctx._copilotkit.runtime;
    const serviceAdapter = ctx._copilotkit.serviceAdapter;
    const responseStatus$ = new Subject<typeof ResponseStatusUnion>();
    const interruptStreaming$ = new Subject<void>();
    const guardrailsResult$ = new Subject<GuardrailsResult>();

    let copilotCloudBaseUrl: string;

    if (process.env.COPILOT_CLOUD_BASE_URL) {
      copilotCloudBaseUrl = process.env.COPILOT_CLOUD_BASE_URL;
    } else if (ctx._copilotkit.baseUrl) {
      copilotCloudBaseUrl = ctx._copilotkit.baseUrl;
    } else {
      copilotCloudBaseUrl = "https://api.cloud.copilotkit.ai";
    }

    const {
      eventSource,
      threadId = nanoid(),
      runId,
    } = await copilotRuntime.process({
      serviceAdapter,
      messages: data.messages,
      actions: data.frontend.actions,
      threadId: data.threadId,
      runId: data.runId,
      publicApiKey: undefined,
    });

    const response = {
      threadId,
      runId,
      status: firstValueFrom(responseStatus$),
      messages: new Repeater(async (pushMessage, stopStreamingMessages) => {
        if (data.cloud?.guardrails) {
          invokeGuardrails({
            baseUrl: copilotCloudBaseUrl,
            copilotCloudPublicApiKey,
            data,
            onResult: (result) => {
              guardrailsResult$.next(result);
              if (result.status === "denied") {
                responseStatus$.next(
                  plainToInstance(FailedResponseStatus, { reason: result.reason }),
                );
                interruptStreaming$.next();
              }
            },
          });
        }

        let eventStreamSubscription: Subscription;

        // run and process the event stream
        const eventStream = eventSource
          .process({
            serversideActions: copilotRuntime.actions,
            guardrailsResult$: data.cloud?.guardrails ? guardrailsResult$ : null,
          })
          .pipe(
            // shareReplay() ensures that later subscribers will see the whole stream instead of
            // just the events that were emitted after the subscriber was added.
            shareReplay(),
            finalize(() => {
              stopStreamingMessages();
            }),
          );

        eventStreamSubscription = eventStream.subscribe({
          next: async (event) => {
            switch (event.type) {
              ////////////////////////////////
              // TextMessageStart
              ////////////////////////////////
              case RuntimeEventTypes.TextMessageStart:
                // create a sub stream that contains the message content
                const textMessageContentStream = eventStream.pipe(
                  // skip until this message start event
                  skipWhile((e) => e !== event),
                  // take until the message end event
                  takeWhile((e) => e.type != RuntimeEventTypes.TextMessageEnd),
                );

                // signal when we are done streaming
                const streamingTextStatus = new Subject<typeof MessageStatusUnion>();
                // push the new message
                pushMessage({
                  id: nanoid(),
                  status: firstValueFrom(streamingTextStatus),
                  createdAt: new Date(),
                  role: MessageRole.assistant,
                  content: new Repeater(async (pushTextChunk, stopStreamingText) => {
                    let textSubscription: Subscription;

                    interruptStreaming$
                      .pipe(
                        take(1),
                        tap(() => {
                          streamingTextStatus.next(
                            plainToInstance(FailedMessageStatus, { reason: "Interrupted" }),
                          );
                          stopStreamingText();
                          textSubscription.unsubscribe();
                        }),
                      )
                      .subscribe();

                    textSubscription = textMessageContentStream.subscribe({
                      next: async (e: RuntimeEvent) => {
                        if (e.type == RuntimeEventTypes.TextMessageContent) {
                          await pushTextChunk(e.content);
                        }
                      },
                      error: (err) => {
                        console.error("Error in text message content stream", err);
                        streamingTextStatus.next(
                          plainToInstance(FailedMessageStatus, { reason: "Error" }),
                        );
                        stopStreamingText();
                        textSubscription.unsubscribe();
                      },
                      complete: () => {
                        streamingTextStatus.next(plainToInstance(SuccessMessageStatus, {}));
                        stopStreamingText();
                        textSubscription.unsubscribe();
                      },
                    });
                  }),
                });
                break;
              ////////////////////////////////
              // ActionExecutionStart
              ////////////////////////////////
              case RuntimeEventTypes.ActionExecutionStart:
                const actionExecutionArgumentStream = eventStream.pipe(
                  skipWhile((e) => e !== event),
                  takeWhile((e) => e.type != RuntimeEventTypes.ActionExecutionEnd),
                );
                const streamingArgumentsStatus = new Subject<typeof MessageStatusUnion>();
                pushMessage({
                  id: event.actionExecutionId,
                  status: firstValueFrom(streamingArgumentsStatus),
                  createdAt: new Date(),
                  name: event.actionName,
                  scope: event.scope!,
                  arguments: new Repeater(async (pushArgumentsChunk, stopStreamingArguments) => {
                    let actionExecutionArgumentSubscription: Subscription;
                    actionExecutionArgumentSubscription = actionExecutionArgumentStream.subscribe({
                      next: async (e: RuntimeEvent) => {
                        if (e.type == RuntimeEventTypes.ActionExecutionArgs) {
                          await pushArgumentsChunk(e.args);
                        }
                      },
                      error: (err) => {
                        console.error("Error in action execution argument stream", err);
                        streamingArgumentsStatus.next(
                          plainToInstance(FailedMessageStatus, { reason: "Error" }),
                        );
                        stopStreamingArguments();
                        actionExecutionArgumentSubscription.unsubscribe();
                      },
                      complete: () => {
                        streamingArgumentsStatus.next(plainToInstance(SuccessMessageStatus, {}));
                        stopStreamingArguments();
                        actionExecutionArgumentSubscription.unsubscribe();
                      },
                    });
                  }),
                });
                break;
              ////////////////////////////////
              // ActionExecutionResult
              ////////////////////////////////
              case RuntimeEventTypes.ActionExecutionResult:
                pushMessage({
                  id: nanoid(),
                  status: plainToInstance(SuccessMessageStatus, {}),
                  createdAt: new Date(),
                  actionExecutionId: event.actionExecutionId,
                  actionName: event.actionName,
                  result: event.result,
                });
                break;
            }
          },
          error: (err) => {
            console.error("Error in event stream", err);
            responseStatus$.next(plainToInstance(FailedResponseStatus, { reason: "Error" }));
            eventStreamSubscription.unsubscribe();
            stopStreamingMessages();
          },
          complete: async () => {
            if (data.cloud?.guardrails) {
              await firstValueFrom(guardrailsResult$);
            }
            responseStatus$.next(plainToInstance(SuccessResponseStatus, {}));
            eventStreamSubscription.unsubscribe();
            stopStreamingMessages();
          },
        });
      }),
    };

    return response;
  }
}
