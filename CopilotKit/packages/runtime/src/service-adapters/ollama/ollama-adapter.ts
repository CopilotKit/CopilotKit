/**
 * CopilotKit Adapter for Ollama
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new OllamaAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new OllamaAdapter({ model: "llama3-70b-8192" }),
 * );
 * ```
 */
import { CopilotKitServiceAdapter } from "../types";
import { CopilotKitResponse } from "../types/service-adapter";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../utils";
import { ChatCompletionChunk, Message } from "@copilotkit/shared";
import { Ollama } from "@langchain/community/llms/ollama";

const DEFAULT_MODEL = "llama3:latest";

interface OllamaAdapterOptions {
  model?: string;
}

export class OllamaAdapter implements CopilotKitServiceAdapter {
  private model: string;

  constructor(options?: OllamaAdapterOptions) {
    if (options?.model) {
      this.model = options.model;
    } else {
      this.model = 'llama3-70b-8192';
    }
  }

  async getResponse(forwardedProps: any): Promise<CopilotKitResponse> {
    const messages = this.transformMessages(forwardedProps.messages);
    // console.log(`>>>> messages: ${JSON.stringify(messages)}`)
    const ollama = new Ollama({
      model: this.model,
    });
    const contents = messages.map((message)=>message.content)
    const _stream = await ollama.stream(contents); // [TODO] role info is dropped...
    
    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunkText of _stream) {
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

  transformMessages(messages: Message[]){
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

  transformMessage(message: Message) {
    if (message.role === "user") {
      return {
        role: "user",
        content: message.content
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