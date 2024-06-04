import {
  Arg,
  Ctx,
  Mutation,
  Query,
  Resolver,
} from "type-graphql";
import { Subject, firstValueFrom } from "rxjs";
import { GenerateResponseInput } from "../inputs/generate-response.input";
import { GeneratedResponse, MessageRole } from "../types/generated-response.type";
import { Repeater } from "graphql-yoga";
import { openaiChatCompletion } from "../../lib/openai-adapter";
import { GraphQLContext } from "../..";

@Resolver(() => GeneratedResponse)
export class ResponseResolver {
  @Query(() => String)
  async hello() {
    return "Hello World";
  }

  @Mutation(() => GeneratedResponse)
  async generateResponse(@Arg("data") data: GenerateResponseInput, @Ctx() ctx: GraphQLContext) {
    const isAborted = new Subject<boolean>();

    const response = {
      isAborted: firstValueFrom(isAborted),
      messages: new Repeater(async (push, stop) => {
        for (const message of data.messages) {
          push({ role: message.role, text: [message.text], isStream: false });
        }

        push({
          role: MessageRole.ASSISTANT,
          text: await openaiChatCompletion(
            data.messages.map((msg) => ({
              role: msg.role as any,
              content: msg.text,
            })),
            () => {
              stop();
              isAborted.next(false);
            },
          ),
          isStream: true,
        });
      }),
    };

    return response;
  }
}
