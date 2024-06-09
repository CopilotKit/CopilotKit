import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import { Subject, firstValueFrom, skipWhile, takeUntil, takeWhile } from "rxjs";
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
      actions: [],
      threadId: data.threadId,
      runId: data.runId,
      publicApiKey: undefined,
    });

    const response = {
      threadId,
      runId,
      interruption: firstValueFrom(interruption),
      messages: new Repeater(async (pushMessage, stopStreamingMessages) => {
        const eventStream = eventSource.process([]);
        eventStream.subscribe({
          next: (event) => {
            switch (event.type) {
              case RuntimeEventTypes.TextMessageStart:
                const messageContentStream = eventStream
                  .pipe(skipWhile((e) => e !== event))
                  .pipe(takeWhile((e) => e.type != RuntimeEventTypes.TextMessageEnd));

                pushMessage({
                  id: nanoid(),
                  isStream: true,
                  role: MessageRole.assistant,
                  content: new Repeater(async (pushTextChunk, stopStreamingText) => {
                    await messageContentStream.forEach(async (e: RuntimeEvent) => {
                      if (e.type == RuntimeEventTypes.TextMessageContent) {
                        await pushTextChunk(e.content);
                      }
                    });
                    stopStreamingText();
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
