import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import {
  ReplaySubject,
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
import { ResponseStatusUnion, SuccessResponseStatus } from "../types/response-status.type";
import { GraphQLJSONObject } from "graphql-scalars";
import { plainToInstance } from "class-transformer";
import { GuardrailsResult } from "../types/guardrails-result.type";
import { GraphQLError } from "graphql";
import {
  GuardrailsValidationFailureResponse,
  MessageStreamInterruptedResponse,
  UnknownErrorResponse,
} from "../../utils";
import { CopilotRuntimeLogger } from "../../lib/logger";

const invokeGuardrails = async ({
  baseUrl,
  copilotCloudPublicApiKey,
  data,
  onResult,
  onError,
}: {
  baseUrl: string;
  copilotCloudPublicApiKey: string;
  data: GenerateCopilotResponseInput;
  onResult: (result: GuardrailsResult) => void;
  onError: (err: Error) => void;
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

    if (guardrailsResult.ok) {
      const resultJson: GuardrailsResult = await guardrailsResult.json();
      onResult(resultJson);
    } else {
      onError(await guardrailsResult.json());
    }
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
    let logger = ctx.logger.child({ component: "CopilotResolver.generateCopilotResponse" });
    logger.debug({ data }, "Generating Copilot response");

    const copilotRuntime = ctx._copilotkit.runtime;
    const serviceAdapter = ctx._copilotkit.serviceAdapter;

    if (properties) {
      logger.debug("Properties provided, merging with context properties");
      ctx.properties = { ...ctx.properties, ...properties };
    }

    let copilotCloudPublicApiKey: string | null = null;
    let copilotCloudBaseUrl: string;

    if (data.cloud) {
      logger = logger.child({ cloud: true });
      logger.debug("Cloud configuration provided, checking for public API key in headers");
      const key = ctx.request.headers.get("x-copilotcloud-public-api-key");
      if (key) {
        logger.debug("Public API key found in headers");
        copilotCloudPublicApiKey = key;
      } else {
        logger.error("Public API key not found in headers");
        throw new GraphQLError("X-CopilotCloud-Public-API-Key header is required");
      }

      if (process.env.COPILOT_CLOUD_BASE_URL) {
        copilotCloudBaseUrl = process.env.COPILOT_CLOUD_BASE_URL;
      } else if (ctx._copilotkit.baseUrl) {
        copilotCloudBaseUrl = ctx._copilotkit.baseUrl;
      } else {
        copilotCloudBaseUrl = "https://api.cloud.copilotkit.ai";
      }

      logger = logger.child({ copilotCloudBaseUrl });
    }
    logger.debug("Setting up subjects");
    const responseStatus$ = new ReplaySubject<typeof ResponseStatusUnion>();
    const interruptStreaming$ = new ReplaySubject<{ reason: string; messageId?: string }>();
    const guardrailsResult$ = new ReplaySubject<GuardrailsResult>();

    logger.debug("Processing");
    const {
      eventSource,
      threadId = nanoid(),
      runId,
      actions,
    } = await copilotRuntime.process({
      serviceAdapter,
      messages: data.messages,
      actions: data.frontend.actions,
      threadId: data.threadId,
      runId: data.runId,
      publicApiKey: undefined,
    });

    logger.debug("Event source created, creating response");

    const response = {
      threadId,
      runId,
      status: firstValueFrom(responseStatus$),
      messages: new Repeater(async (pushMessage, stopStreamingMessages) => {
        logger.debug("Messages repeater created");

        if (data.cloud?.guardrails) {
          logger = logger.child({ guardrails: true });
          logger.debug("Guardrails is enabled, validating input");

          invokeGuardrails({
            baseUrl: copilotCloudBaseUrl,
            copilotCloudPublicApiKey,
            data,
            logger,
            onResult: (result) => {
              logger.debug({ status: result.status }, "Guardrails validation done");
              guardrailsResult$.next(result);
              if (result.status === "denied") {
                responseStatus$.next(
                  new GuardrailsValidationFailureResponse({ guardrailsReason: result.reason }),
                );
                interruptStreaming$.next({
                  reason: `Interrupted due to Guardrails validation failure. Reason: ${result.reason}`,
                });
              }
            },
            onError: (err) => {
              logger.error({ err }, "Error in guardrails validation");
              responseStatus$.next(
                new UnknownErrorResponse({
                  description: `An unknown error has occurred in the guardrails validation`,
                }),
              );
              interruptStreaming$.next({
                reason: `Interrupted due to unknown error in guardrails validation`,
              });
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
              logger.debug("Event stream finalized, stopping streaming messages");
              stopStreamingMessages();
            }),
          );

        logger.debug("Event stream created, subscribing to event stream");

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

                const messageId = nanoid();

                // push the new message
                pushMessage({
                  id: messageId,
                  status: firstValueFrom(streamingTextStatus),
                  createdAt: new Date(),
                  role: MessageRole.assistant,
                  content: new Repeater(async (pushTextChunk, stopStreamingText) => {
                    logger.debug("Text message content repeater created");

                    let textSubscription: Subscription;

                    interruptStreaming$
                      .pipe(
                        shareReplay(),
                        take(1),
                        tap(({ reason, messageId }) => {
                          logger.debug({ reason, messageId }, "Text streaming interrupted");

                          streamingTextStatus.next(
                            plainToInstance(FailedMessageStatus, { reason }),
                          );

                          responseStatus$.next(new MessageStreamInterruptedResponse({ messageId }));
                          stopStreamingText();
                          textSubscription?.unsubscribe();
                        }),
                      )
                      .subscribe();

                    logger.debug("Subscribing to text message content stream");

                    textSubscription = textMessageContentStream.subscribe({
                      next: async (e: RuntimeEvent) => {
                        if (e.type == RuntimeEventTypes.TextMessageContent) {
                          await pushTextChunk(e.content);
                        }
                      },
                      error: (err) => {
                        logger.error({ err }, "Error in text message content stream");
                        interruptStreaming$.next({
                          reason: "Error streaming message content",
                          messageId,
                        });
                        stopStreamingText();
                        textSubscription?.unsubscribe();
                      },
                      complete: () => {
                        logger.debug("Text message content stream completed");
                        streamingTextStatus.next(new SuccessMessageStatus());
                        stopStreamingText();
                        textSubscription?.unsubscribe();
                      },
                    });
                  }),
                });
                break;
              ////////////////////////////////
              // ActionExecutionStart
              ////////////////////////////////
              case RuntimeEventTypes.ActionExecutionStart:
                logger.debug("Action execution start event received");
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
                    logger.debug("Action execution argument stream created");

                    let actionExecutionArgumentSubscription: Subscription;
                    actionExecutionArgumentSubscription = actionExecutionArgumentStream.subscribe({
                      next: async (e: RuntimeEvent) => {
                        if (e.type == RuntimeEventTypes.ActionExecutionArgs) {
                          await pushArgumentsChunk(e.args);
                        }
                      },
                      error: (err) => {
                        logger.error({ err }, "Error in action execution argument stream");
                        streamingArgumentsStatus.next(
                          plainToInstance(FailedMessageStatus, {
                            reason:
                              "An unknown error has occurred in the action execution argument stream",
                          }),
                        );
                        stopStreamingArguments();
                        actionExecutionArgumentSubscription?.unsubscribe();
                      },
                      complete: () => {
                        logger.debug("Action execution argument stream completed");
                        streamingArgumentsStatus.next(new SuccessMessageStatus());
                        stopStreamingArguments();
                        actionExecutionArgumentSubscription?.unsubscribe();
                      },
                    });
                  }),
                });
                break;
              ////////////////////////////////
              // ActionExecutionResult
              ////////////////////////////////
              case RuntimeEventTypes.ActionExecutionResult:
                logger.debug("Action execution result event received");
                pushMessage({
                  id: nanoid(),
                  status: new SuccessMessageStatus(),
                  createdAt: new Date(),
                  actionExecutionId: event.actionExecutionId,
                  actionName: event.actionName,
                  result: event.result,
                });
                break;
            }
          },
          error: (err) => {
            logger.error({ err }, "Error in event stream");
            responseStatus$.next(
              new UnknownErrorResponse({
                description: `An unknown error has occurred in the event stream`,
              }),
            );
            eventStreamSubscription?.unsubscribe();
            stopStreamingMessages();
          },
          complete: async () => {
            logger.debug("Event stream completed");
            if (data.cloud?.guardrails) {
              logger.debug("Guardrails is enabled, waiting for guardrails result");
              await firstValueFrom(guardrailsResult$);
            }
            responseStatus$.next(new SuccessResponseStatus());
            eventStreamSubscription?.unsubscribe();
            stopStreamingMessages();
          },
        });
      }),
    };

    return response;
  }
}
