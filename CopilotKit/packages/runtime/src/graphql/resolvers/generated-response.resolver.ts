import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import { Subject, firstValueFrom } from "rxjs";
import { GenerateResponseInput } from "../inputs/generate-response.input";
import {
  GeneratedResponse,
  MessageRole,
} from "../types/generated-response.type";
import { Repeater } from "graphql-yoga";
import { GraphQLContext } from "../../test-server/test-server";
import { GenerationInterruption } from "../types/generation-interruption";
import { CopilotRuntime, OpenAIAdapter } from "../../lib";
import { OpenAI } from "openai";
import { interceptStreamAndGetFinalResponse } from "../../lib/stream-utils";

@Resolver(() => Response)
export class GeneratedResponseResolver {
  @Query(() => String)
  async hello() {
    return "Hello World";
  }

  @Mutation(() => GeneratedResponse)
  async generateResponse(
    @Arg("data") data: GenerateResponseInput,
    @Ctx() ctx: GraphQLContext
  ) {
    const openai = new OpenAI();
    const copilotRuntime = new CopilotRuntime();
    const openaiAdapter = new OpenAIAdapter({ openai: openai as any });

    const interruption = new Subject<GenerationInterruption>();
    const response = {
      interruption: firstValueFrom(interruption),
      messages: new Repeater(async (pushMessage, stopStreamingMessages) => {
        for (const message of data.messages) {
          pushMessage({ role: message.role, content: [message.content], isStream: false });
        }

        pushMessage({
          isStream: true,
          role: MessageRole.assistant,
          content: await (async () => {
            const { stream, headers } = await copilotRuntime.gqlResponse(openaiAdapter, {
              messages: data.messages
            });

            return new Repeater(async (pushTextChunk, stopStreamingText) => {
              console.log("repeater start")
              await interceptStreamAndGetFinalResponse(stream, (chunk: string) => {
                pushTextChunk(chunk);
              });
              console.log("repeater finish")
              stopStreamingText();
              stopStreamingMessages();
              interruption.next({ interrupted: false });
            });        
          })(),
        });
      }),
    };

    return response;
  }
}
