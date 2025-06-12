import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import {
  ReplaySubject,
  Subject,
  Subscription,
  filter,
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
import {
  CopilotKitLangGraphInterruptEvent,
  LangGraphInterruptEvent,
} from "../types/meta-events.type";
import { ActionInputAvailability, MessageRole } from "../types/enums";
import { Repeater } from "graphql-yoga";
import type { CopilotRequestContextProperties, GraphQLContext } from "../../lib/integrations";
import {
  RuntimeEvent,
  RuntimeEventTypes,
  RuntimeMetaEventName,
} from "../../service-adapters/events";
import {
  FailedMessageStatus,
  MessageStatusCode,
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
  StructuredErrorResponse,
  UnknownErrorResponse,
} from "../../utils/failed-response-status-reasons";
import {
  ActionExecutionMessage,
  AgentStateMessage,
  Message,
  MessageType,
  ResultMessage,
  TextMessage,
} from "../types/converted";
import telemetry from "../../lib/telemetry-client";
import { randomId } from "@copilotkit/shared";
import { AgentsResponse } from "../types/agents-response.type";
import { LangGraphEventTypes } from "../../agents/langgraph/events";

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
  if (
    data.messages.length &&
    data.messages[data.messages.length - 1].textMessage?.role === MessageRole.user
  ) {
    const messages = data.messages
      .filter(
        (m) =>
          m.textMessage !== undefined &&
          (m.textMessage.role === MessageRole.user || m.textMessage.role === MessageRole.assistant),
      )
      .map((m) => ({
        role: m.textMessage!.role,
        content: m.textMessage.content,
      }));

    const lastMessage = messages[messages.length - 1];
    const restOfMessages = messages.slice(0, -1);

    const body = {
      input: lastMessage.content,
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

  @Query(() => AgentsResponse)
  async availableAgents(@Ctx() ctx: GraphQLContext) {
    let logger = ctx.logger.child({ component: "CopilotResolver.availableAgents" });

    logger.debug("Processing");
    const agentsWithEndpoints = await ctx._copilotkit.runtime.discoverAgentsFromEndpoints(ctx);

    logger.debug("Event source created, creating response");

    return {
      agents: agentsWithEndpoints.map(
        ({ endpoint, ...agentWithoutEndpoint }) => agentWithoutEndpoint,
      ),
    };
  }

  @Mutation(() => CopilotResponse)
  async generateCopilotResponse(
    @Ctx() ctx: GraphQLContext,
    @Arg("data") data: GenerateCopilotResponseInput,
    @Arg("properties", () => GraphQLJSONObject, { nullable: true })
    properties?: CopilotRequestContextProperties,
  ) {
    telemetry.capture("oss.runtime.copilot_request_created", {
      "cloud.guardrails.enabled": data.cloud?.guardrails !== undefined,
      requestType: data.metadata.requestType,
    });

    let logger = ctx.logger.child({ component: "CopilotResolver.generateCopilotResponse" });
    logger.debug({ data }, "Generating Copilot response");

    if (properties) {
      logger.debug("Properties provided, merging with context properties");
      ctx.properties = { ...ctx.properties, ...properties };
    }

    const copilotRuntime = ctx._copilotkit.runtime;
    const serviceAdapter = ctx._copilotkit.serviceAdapter;

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
      } else if (ctx._copilotkit.cloud?.baseUrl) {
        copilotCloudBaseUrl = ctx._copilotkit.cloud?.baseUrl;
      } else {
        copilotCloudBaseUrl = "https://api.cloud.copilotkit.ai";
      }

      logger = logger.child({ copilotCloudBaseUrl });
    }

    logger.debug("Setting up subjects");
    const responseStatus$ = new ReplaySubject<typeof ResponseStatusUnion>();
    const interruptStreaming$ = new ReplaySubject<{ reason: string; messageId?: string }>();
    const guardrailsResult$ = new ReplaySubject<GuardrailsResult>();

    let outputMessages: Message[] = [];
    let resolveOutputMessagesPromise: (messages: Message[]) => void;
    let rejectOutputMessagesPromise: (err: Error) => void;

    const outputMessagesPromise = new Promise<Message[]>((resolve, reject) => {
      resolveOutputMessagesPromise = resolve;
      rejectOutputMessagesPromise = reject;
    });

    if (copilotCloudPublicApiKey) {
      ctx.properties["copilotCloudPublicApiKey"] = copilotCloudPublicApiKey;
    }

    logger.debug("Processing");
    const {
      eventSource,
      threadId = randomId(),
      runId,
      serverSideActions,
      actionInputsWithoutAgents,
      extensions,
    } = await copilotRuntime.processRuntimeRequest({
      serviceAdapter,
      messages: data.messages,
      actions: data.frontend.actions.filter(
        (action) => action.available !== ActionInputAvailability.disabled,
      ),
      threadId: data.threadId,
      runId: data.runId,
      publicApiKey: copilotCloudPublicApiKey,
      outputMessagesPromise,
      graphqlContext: ctx,
      forwardedParameters: data.forwardedParameters,
      agentSession: data.agentSession,
      agentStates: data.agentStates,
      url: data.frontend.url,
      extensions: data.extensions,
      metaEvents: data.metaEvents,
    });

    logger.debug("Event source created, creating response");
    // run and process the event stream
    const eventStream = eventSource
      .processRuntimeEvents({
        serverSideActions,
        guardrailsResult$: data.cloud?.guardrails ? guardrailsResult$ : null,
        actionInputsWithoutAgents: actionInputsWithoutAgents.filter(
          // TODO-AGENTS: do not exclude ALL server side actions
          (action) =>
            !serverSideActions.find((serverSideAction) => serverSideAction.name == action.name),
        ),
        threadId,
      })
      .pipe(
        // shareReplay() ensures that later subscribers will see the whole stream instead of
        // just the events that were emitted after the subscriber was added.
        shareReplay(),
        finalize(() => {
          logger.debug("Event stream finalized");
        }),
      );

    // Create the response with async status resolution
    const createResponse = async () => {
      const resolvedStatus = await firstValueFrom(responseStatus$);
      return {
        threadId,
        runId,
        status: resolvedStatus,
        extensions,
        metaEvents: new Repeater(async (push, stop) => {
          let eventStreamSubscription: Subscription;

          eventStreamSubscription = eventStream.subscribe({
            next: async (event) => {
              if (event.type != RuntimeEventTypes.MetaEvent) {
                return;
              }
              switch (event.name) {
                // @ts-ignore
                case LangGraphEventTypes.OnInterrupt:
                  push(
                    plainToInstance(LangGraphInterruptEvent, {
                      // @ts-ignore
                      type: event.type,
                      // @ts-ignore
                      name: RuntimeMetaEventName.LangGraphInterruptEvent,
                      // @ts-ignore
                      value: event.value,
                    }),
                  );
                  break;
                case RuntimeMetaEventName.LangGraphInterruptEvent:
                  push(
                    plainToInstance(LangGraphInterruptEvent, {
                      type: event.type,
                      name: event.name,
                      value: event.value,
                    }),
                  );
                  break;
                case RuntimeMetaEventName.CopilotKitLangGraphInterruptEvent:
                  push(
                    plainToInstance(CopilotKitLangGraphInterruptEvent, {
                      type: event.type,
                      name: event.name,
                      data: {
                        value: event.data.value,
                        messages: event.data.messages.map((message) => {
                          if (
                            message.type === "TextMessage" ||
                            ("content" in message && "role" in message)
                          ) {
                            return plainToInstance(TextMessage, {
                              id: message.id,
                              createdAt: new Date(),
                              content: [(message as TextMessage).content],
                              role: (message as TextMessage).role,
                              status: new SuccessMessageStatus(),
                            });
                          }
                          if ("arguments" in message) {
                            return plainToInstance(ActionExecutionMessage, {
                              name: message.name,
                              id: message.id,
                              arguments: [JSON.stringify(message.arguments)],
                              createdAt: new Date(),
                              status: new SuccessMessageStatus(),
                            });
                          }
                          throw new Error("Unknown message in metaEvents copilot resolver");
                        }),
                      },
                    }),
                  );
                  break;
              }
            },
            error: (err) => {
              logger.error({ err }, "Error in meta events stream");
              responseStatus$.next(
                new UnknownErrorResponse({
                  description: `An unknown error has occurred in the event stream`,
                }),
              );
              eventStreamSubscription?.unsubscribe();
              stop();
            },
            complete: async () => {
              logger.debug("Meta events stream completed");
              responseStatus$.next(new SuccessResponseStatus());
              eventStreamSubscription?.unsubscribe();
              stop();
            },
          });
        }),
        messages: new Repeater(async (pushMessage, stopStreamingMessages) => {
          logger.debug("Messages repeater created");

          if (data.cloud?.guardrails) {
            logger = logger.child({ guardrails: true });
            logger.debug("Guardrails is enabled, validating input");

            invokeGuardrails({
              baseUrl: copilotCloudBaseUrl,
              copilotCloudPublicApiKey,
              data,
              onResult: (result) => {
                logger.debug({ status: result.status }, "Guardrails validation done");
                guardrailsResult$.next(result);

                // Guardrails validation failed
                if (result.status === "denied") {
                  // send the reason to the client and interrupt streaming
                  responseStatus$.next(
                    new GuardrailsValidationFailureResponse({ guardrailsReason: result.reason }),
                  );
                  interruptStreaming$.next({
                    reason: `Interrupted due to Guardrails validation failure. Reason: ${result.reason}`,
                  });

                  // resolve messages promise to the middleware
                  outputMessages = [
                    plainToInstance(TextMessage, {
                      id: randomId(),
                      createdAt: new Date(),
                      content: result.reason,
                      role: MessageRole.assistant,
                    }),
                  ];
                  resolveOutputMessagesPromise(outputMessages);
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

                // reject the middleware promise
                rejectOutputMessagesPromise(err);
              },
            });
          }

          let eventStreamSubscription: Subscription;

          logger.debug("Event stream created, subscribing to event stream");

          eventStreamSubscription = eventStream.subscribe({
            next: async (event) => {
              switch (event.type) {
                case RuntimeEventTypes.MetaEvent:
                  break;
                ////////////////////////////////
                // StructuredError - Route through runtime error handling
                ////////////////////////////////
                case RuntimeEventTypes.StructuredError:
                  logger.debug(
                    { error: event.error, context: event.context },
                    "Structured error event received",
                  );
                  try {
                    // Use the runtime's structured error handling
                    const categorizedError = await copilotRuntime.handleError(
                      event.error,
                      event.context,
                    );

                    // Create detailed error message with available properties
                    let errorDetails = `${categorizedError.message}`;
                    if ("category" in categorizedError) {
                      errorDetails += ` [Category: ${categorizedError.category}]`;
                    }
                    if ("type" in categorizedError) {
                      errorDetails += ` [Type: ${categorizedError.type}]`;
                    }
                    if ("provider" in categorizedError && categorizedError.provider) {
                      errorDetails += ` [Provider: ${categorizedError.provider}]`;
                    }
                    if ("agentName" in categorizedError && categorizedError.agentName) {
                      errorDetails += ` [Agent: ${categorizedError.agentName}]`;
                    }

                    // Send structured error as response
                    responseStatus$.next(
                      new StructuredErrorResponse({
                        categorizedError,
                        description: errorDetails,
                      }),
                    );
                    interruptStreaming$.next({
                      reason: `Structured error: ${categorizedError.message}`,
                    });
                  } catch (handlingError) {
                    logger.error({ handlingError }, "Error handling structured error");
                    // Fallback to generic error if error handling fails
                    responseStatus$.next(
                      new UnknownErrorResponse({
                        description: `An error occurred while processing the request`,
                      }),
                    );
                    interruptStreaming$.next({
                      reason: "An error occurred while processing the request",
                    });
                  }
                  break;
                ////////////////////////////////
                // TextMessageStart
                ////////////////////////////////
                case RuntimeEventTypes.TextMessageStart:
                  // create a sub stream that contains the message content
                  const textMessageContentStream = eventStream.pipe(
                    // skip until this message start event
                    skipWhile((e) => e !== event),
                    // take until the message end event
                    takeWhile(
                      (e) =>
                        !(
                          e.type === RuntimeEventTypes.TextMessageEnd &&
                          e.messageId == event.messageId
                        ),
                    ),
                    // filter out any other message events or message ids
                    filter(
                      (e) =>
                        e.type == RuntimeEventTypes.TextMessageContent &&
                        e.messageId == event.messageId,
                    ),
                  );

                  // signal when we are done streaming
                  const streamingTextStatus = new Subject<typeof MessageStatusUnion>();

                  const messageId = event.messageId;
                  // push the new message
                  pushMessage({
                    id: messageId,
                    parentMessageId: event.parentMessageId,
                    status: firstValueFrom(streamingTextStatus),
                    createdAt: new Date(),
                    role: MessageRole.assistant,
                    content: new Repeater(async (pushTextChunk, stopStreamingText) => {
                      logger.debug("Text message content repeater created");

                      const textChunks: string[] = [];
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

                            responseStatus$.next(
                              new MessageStreamInterruptedResponse({ messageId }),
                            );
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
                            textChunks.push(e.content);
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

                          outputMessages.push(
                            plainToInstance(TextMessage, {
                              id: messageId,
                              createdAt: new Date(),
                              content: textChunks.join(""),
                              role: MessageRole.assistant,
                            }),
                          );
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
                    // take until the action execution end event
                    takeWhile(
                      (e) =>
                        !(
                          e.type === RuntimeEventTypes.ActionExecutionEnd &&
                          e.actionExecutionId == event.actionExecutionId
                        ),
                    ),
                    // filter out any other action execution events or action execution ids
                    filter(
                      (e) =>
                        e.type == RuntimeEventTypes.ActionExecutionArgs &&
                        e.actionExecutionId == event.actionExecutionId,
                    ),
                  );
                  const streamingArgumentsStatus = new Subject<typeof MessageStatusUnion>();
                  pushMessage({
                    id: event.actionExecutionId,
                    parentMessageId: event.parentMessageId,
                    status: firstValueFrom(streamingArgumentsStatus),
                    createdAt: new Date(),
                    name: event.actionName,
                    arguments: new Repeater(async (pushArgumentsChunk, stopStreamingArguments) => {
                      logger.debug("Action execution argument stream created");

                      const argumentChunks: string[] = [];
                      let actionExecutionArgumentSubscription: Subscription;

                      actionExecutionArgumentSubscription = actionExecutionArgumentStream.subscribe(
                        {
                          next: async (e: RuntimeEvent) => {
                            if (e.type == RuntimeEventTypes.ActionExecutionArgs) {
                              await pushArgumentsChunk(e.args);
                              argumentChunks.push(e.args);
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

                            outputMessages.push(
                              plainToInstance(ActionExecutionMessage, {
                                id: event.actionExecutionId,
                                createdAt: new Date(),
                                name: event.actionName,
                                arguments: argumentChunks.join(""),
                              }),
                            );
                          },
                        },
                      );
                    }),
                  });
                  break;
                ////////////////////////////////
                // ActionExecutionResult
                ////////////////////////////////
                case RuntimeEventTypes.ActionExecutionResult:
                  logger.debug({ result: event.result }, "Action execution result event received");
                  pushMessage({
                    id: "result-" + event.actionExecutionId,
                    status: new SuccessMessageStatus(),
                    createdAt: new Date(),
                    actionExecutionId: event.actionExecutionId,
                    actionName: event.actionName,
                    result: event.result,
                  });

                  outputMessages.push(
                    plainToInstance(ResultMessage, {
                      id: "result-" + event.actionExecutionId,
                      createdAt: new Date(),
                      actionExecutionId: event.actionExecutionId,
                      actionName: event.actionName,
                      result: event.result,
                    }),
                  );
                  break;
                ////////////////////////////////
                // AgentStateMessage
                ////////////////////////////////
                case RuntimeEventTypes.AgentStateMessage:
                  logger.debug({ event }, "Agent message event received");
                  pushMessage({
                    id: randomId(),
                    status: new SuccessMessageStatus(),
                    threadId: event.threadId,
                    agentName: event.agentName,
                    nodeName: event.nodeName,
                    runId: event.runId,
                    active: event.active,
                    state: event.state,
                    running: event.running,
                    role: MessageRole.assistant,
                    createdAt: new Date(),
                  });
                  outputMessages.push(
                    plainToInstance(AgentStateMessage, {
                      id: randomId(),
                      threadId: event.threadId,
                      agentName: event.agentName,
                      nodeName: event.nodeName,
                      runId: event.runId,
                      active: event.active,
                      state: event.state,
                      running: event.running,
                      role: MessageRole.assistant,
                      createdAt: new Date(),
                    }),
                  );
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

              rejectOutputMessagesPromise(err);
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

              resolveOutputMessagesPromise(outputMessages);
            },
          });
        }),
      };
    };

    return await createResponse();
  }
}
