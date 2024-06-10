import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import { Subject, firstValueFrom, shareReplay, skipWhile, takeWhile } from "rxjs";
import { GenerateResponseInput } from "../inputs/generate-response.input";
import { GeneratedResponse, MessageRole } from "../types/generated-response.type";
import { Repeater } from "graphql-yoga";
import type { GraphQLContext } from "../../test-server/test-server";
import { GenerationInterruption } from "../types/generation-interruption";
import { CopilotRuntime, OpenAIAdapter } from "../../lib";
import { OpenAI } from "openai";
import { nanoid } from "nanoid";
import { RuntimeEvent, RuntimeEventTypes } from "../../service-adapters/events";

@Resolver(() => Response)
export class GeneratedResponseResolver {
  @Query(() => String)
  async hello() {
    return "Hello World";
  }

  @Mutation(() => GeneratedResponse)
  async generateResponse(@Arg("data") data: GenerateResponseInput, @Ctx() ctx: GraphQLContext) {
    const openai = new OpenAI();
    const copilotRuntime = new CopilotRuntime();
    const openaiAdapter = new OpenAIAdapter({ openai });

    const interruption = new Subject<GenerationInterruption>();
    const {
      eventSource,
      threadId = nanoid(),
      runId,
    } = await copilotRuntime.process({
      serviceAdapter: openaiAdapter,
      messages: data.messages,
      actions: data.frontend.actions,
      threadId: data.threadId,
      runId: data.runId,
      publicApiKey: undefined,
    });

    const response = {
      threadId,
      runId,
      interruption: firstValueFrom(interruption),
      messages: new Repeater(async (pushMessage, stopStreamingMessages) => {
        // run and process the event stream
        const eventStream = eventSource.process([]).pipe(
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

                // push the new message
                pushMessage({
                  id: nanoid(),
                  role: MessageRole.assistant,
                  content: new Repeater(async (pushTextChunk, stopStreamingText) => {
                    // push the message content
                    await textMessageContentStream.forEach(async (e: RuntimeEvent) => {
                      if (e.type == RuntimeEventTypes.TextMessageContent) {
                        await pushTextChunk(e.content);
                      }
                    });
                    stopStreamingText();
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
                pushMessage({
                  id: nanoid(),
                  role: MessageRole.assistant,
                  name: event.actionName,
                  scope: event.scope!,
                  arguments: new Repeater(async (pushArgumentsChunk, stopStreamingArguments) => {
                    await actionExecutionArgumentStream.forEach(async (e: RuntimeEvent) => {
                      if (e.type == RuntimeEventTypes.ActionExecutionArgs) {
                        await pushArgumentsChunk(e.args);
                      }
                    });
                    stopStreamingArguments();
                  }),
                });
                break;
            }
          },
          error: (err) => console.error("Error in event source", err),
          complete: () => {
            stopStreamingMessages();
            interruption.next({ interrupted: false });
          },
        });
      }),
    };

    return response;
  }
}
