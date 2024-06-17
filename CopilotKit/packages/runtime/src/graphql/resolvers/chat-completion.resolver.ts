import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import { Subject, firstValueFrom, shareReplay, skipWhile, takeWhile } from "rxjs";
import { CreateChatCompletionInput } from "../inputs/create-chat-completion.input";
import { ChatCompletion } from "../types/chat-completion.type";
import { MessageRole } from "../types/enums";
import { Repeater } from "graphql-yoga";
import type { GraphQLContext } from "../../lib/integrations";
import { nanoid } from "nanoid";
import { RuntimeEvent, RuntimeEventTypes } from "../../service-adapters/events";
import { MessageStatusUnion, SuccessMessageStatus } from "../types/message-status.type";
import { ResponseStatusUnion, SuccessResponseStatus } from "../types/response-status.type";
import { PropertyInput } from "../inputs/properties.input";

@Resolver(() => Response)
export class ChatCompletionResolver {
  @Query(() => String)
  async hello() {
    return "Hello World";
  }

  @Mutation(() => ChatCompletion)
  async createChatCompletion(
    @Arg("data") data: CreateChatCompletionInput,
    @Arg("properties", () => [PropertyInput], { nullable: true }) properties: PropertyInput[] = [],
    @Ctx() ctx: GraphQLContext,
  ) {
    ctx._copilotkit.properties = [...ctx._copilotkit.properties, ...properties];

    const copilotRuntime = ctx._copilotkit.runtime;
    const serviceAdapter = ctx._copilotkit.serviceAdapter;
    const responseStatus = new Subject<typeof ResponseStatusUnion>();

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
      status: firstValueFrom(responseStatus),
      messages: new Repeater(async (pushMessage, stopStreamingMessages) => {
        // run and process the event stream
        const eventStream = eventSource.process(copilotRuntime.actions).pipe(
          // shareReplay() ensures that later subscribers will see the whole stream instead of
          // just the events that were emitted after the subscriber was added.
          shareReplay(),
        );
        eventStream.subscribe({
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
                    // push the message content
                    await textMessageContentStream.forEach(async (e: RuntimeEvent) => {
                      if (e.type == RuntimeEventTypes.TextMessageContent) {
                        await pushTextChunk(e.content);
                      }
                    });
                    stopStreamingText();
                    streamingTextStatus.next(new SuccessMessageStatus());
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
                    await actionExecutionArgumentStream.forEach(async (e: RuntimeEvent) => {
                      if (e.type == RuntimeEventTypes.ActionExecutionArgs) {
                        await pushArgumentsChunk(e.args);
                      }
                    });
                    stopStreamingArguments();
                    streamingArgumentsStatus.next(new SuccessMessageStatus());
                  }),
                });
                break;
              ////////////////////////////////
              // ActionExecutionResult
              ////////////////////////////////
              case RuntimeEventTypes.ActionExecutionResult:
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
          error: (err) => console.error("Error in event source", err),
          complete: () => {
            responseStatus.next(new SuccessResponseStatus());
            stopStreamingMessages();
          },
        });
      }),
    };

    return response;
  }
}
