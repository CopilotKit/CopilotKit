/**
 * CopilotKit Adapter for Groq
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new GroqAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new GroqAdapter({ model: "llama3-70b-8192" }),
 * );
 * ```
 */
import { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { CopilotKitServiceAdapter } from "../types";
import { maxTokensForGroqModel } from "../utils/groq";
import { CopilotKitResponse } from "../types/service-adapter";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../utils";
import { ChatCompletionChunk, Message } from "@copilotkit/shared";
import Groq from "groq-sdk";

const DEFAULT_MODEL = "llama3-70b-8192";
const groq = new Groq();

interface GroqAdapterOptions {
  model?: string;
}

export class GroqAdapter implements CopilotKitServiceAdapter {
  private model: string;

  constructor(options?: GroqAdapterOptions) {
    if (options?.model) {
      this.model = options.model;
    } else {
      this.model = "llama3-70b-8192";
    }
  }

  async getResponse(forwardedProps: any): Promise<CopilotKitResponse> {
    const messages = this.transformMessages(forwardedProps.messages);
    // console.log(`>>>> messages: ${JSON.stringify(messages)}`)
    const max_tokens = maxTokensForGroqModel(this.model);
    const _stream = await groq.chat.completions.create({
      //
      // Required parameters
      //
      messages: messages,

      // The language model which will generate the completion.
      model: this.model,

      //
      // Optional parameters
      //

      // Controls randomness: lowering results in less random completions.
      // As the temperature approaches zero, the model will become deterministic
      // and repetitive.
      temperature: 0.5, // [TODO]

      // The maximum number of tokens to generate. Requests can use up to
      // 2048 tokens shared between prompt and completion.
      max_tokens: max_tokens,

      // Controls diversity via nucleus sampling: 0.5 means half of all
      // likelihood-weighted options are considered.
      top_p: 1, // [TODO]

      // A stop sequence is a predefined or user-specified text string that
      // signals an AI to stop generating content, ensuring its responses
      // remain focused and concise. Examples include punctuation marks and
      // markers like "[end]".
      stop: null,

      // If set, partial message deltas will be sent.
      stream: true,
    });

    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of _stream) {
          const chunkText = chunk.choices[0]?.delta?.content || "";
          const ccChunk: ChatCompletionChunk = {
            choices: [
              {
                delta: {
                  role: "assistant",
                  content: chunkText,
                },
              },
            ],
          };

          writeChatCompletionChunk(controller, ccChunk);
        }

        // we may need to add this later.. [nc]
        // let calls = (await result.response).functionCalls();
        // if (calls && calls.length > 0) {
        //   const ccChunk: ChatCompletionChunk = {
        //     choices: [
        //       {
        //         delta: {
        //           role: "assistant",
        //           content: "",
        //           tool_calls: calls.map((call, ix) => ({
        //             index: ix,
        //             id: ix + "",
        //             function: {
        //               name: call.name,
        //               arguments: JSON.stringify(replaceNewlinesInObject(call.args)),
        //             },
        //           })),
        //         },
        //       },
        //     ],
        //   };

        //   writeChatCompletionChunk(controller, ccChunk);
        // }
        writeChatCompletionEnd(controller);
        controller.close();
      },
    });

    return {
      stream,
    };
  }

  transformMessages(messages: Message[]): ChatCompletionMessageParam[] {
    return messages
      .filter(
        (m) =>
          m.role === "user" ||
          m.role === "assistant" ||
          m.role === "function" ||
          m.role === "system",
      )
      .map(this.transformMessage);
  }

  transformMessage(message: Message): ChatCompletionMessageParam {
    if (message.role === "user") {
      return {
        role: "user",
        content: message.content,
      };
    } else if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content.replace("\\\\n", "\n"),
      };
    }

    // else if (message.role === "assistant") {
    //   if (message.function_call) {
    //     return {
    //       role: "model",
    //       parts: [
    //         {
    //           functionCall: {
    //             name: message.function_call.name!,
    //             args: JSON.parse(message.function_call!.arguments!),
    //           },
    //         },
    //       ],
    //     };
    //   } else {
    //     return {
    //       role: "model",
    //       parts: [{ text: message.content.replace("\\\\n", "\n") }],
    //     };
    //   }
    // }
    else if (message.role === "system") {
      return {
        role: "system",
        content: message.content,
      };
    }
    // else if (message.role === "system") {
    //   return {
    //     role: "user",
    //     parts: [
    //       {
    //         text:
    //           "THE FOLLOWING MESSAGE IS NOT A USER MESSAGE. IT IS A SYSTEM MESSAGE: " +
    //           message.content,
    //       },
    //     ],
    //   };
    // }

    throw new Error("Invalid message role");
  }
}

export function maxTokensForGroqModel(model: string): number {
  return maxTokensByModel[model] || DEFAULT_MAX_TOKENS;
}

const DEFAULT_MAX_TOKENS = 8192;

const maxTokensByModel: { [key: string]: number } = {
  // llama3
  "llama3-8b-8192": DEFAULT_MAX_TOKENS,
  "llama3-70b-8192": DEFAULT_MAX_TOKENS,
};
