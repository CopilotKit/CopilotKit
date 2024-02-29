import { ChatCompletionChunk } from "@copilotkit/shared";
import {
  AIMessage,
  BaseMessage,
  BaseMessageChunk,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { CopilotKitServiceAdapter } from "../types";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../utils";
import { CopilotKitResponse } from "../types/service-adapter";

export type LangChainMessageStream = IterableReadableStream<BaseMessageChunk>;
export type LangChainReturnType = LangChainMessageStream | BaseMessageChunk | string | AIMessage;

export class LangChainAdapter implements CopilotKitServiceAdapter {
  constructor(private chainFn: (forwardedProps: any) => Promise<LangChainReturnType>) {}

  async getResponse(forwardedProps: any): Promise<CopilotKitResponse> {
    forwardedProps = this.transformProps(forwardedProps);

    const result = await this.chainFn(forwardedProps);

    // We support several types of return values from LangChain functions:

    // 1. string
    // Just send one chunk with the string as the content.
    if (typeof result === "string") {
      return {
        stream: new SingleChunkReadableStream(result),
      };
    }

    // 2. AIMessage
    // Send the content and function call of the AIMessage as the content of the chunk.
    else if ("content" in result && typeof result.content === "string") {
      return {
        stream: new SingleChunkReadableStream(result.content, result.additional_kwargs?.tool_calls),
      };
    }

    // 3. BaseMessageChunk
    // Send the content and function call of the AIMessage as the content of the chunk.
    else if ("lc_kwargs" in result) {
      return {
        stream: new SingleChunkReadableStream(
          result.lc_kwargs?.content,
          result.lc_kwargs?.tool_calls,
        ),
      };
    }

    // 4. IterableReadableStream
    // Stream the result of the LangChain function.
    else if ("getReader" in result) {
      return {
        stream: this.streamResult(result),
      };
    }

    // TODO write function call result!

    console.error("Invalid return type from LangChain function.");
    throw new Error("Invalid return type from LangChain function.");
  }

  /**
   * Transforms the props that are forwarded to the LangChain function.
   * Currently this just transforms the messages to the format that LangChain expects.
   *
   * @param forwardedProps
   * @returns {any}
   */
  private transformProps(forwardedProps: any) {
    const forwardedPropsCopy = Object.assign({}, forwardedProps);

    // map messages to langchain format
    if (forwardedProps.messages && Array.isArray(forwardedProps.messages)) {
      const newMessages: BaseMessage[] = [];
      for (const message of forwardedProps.messages) {
        if (message.role === "user") {
          newMessages.push(new HumanMessage(message.content));
        } else if (message.role === "assistant") {
          newMessages.push(new AIMessage(message.content));
        } else if (message.role === "system") {
          newMessages.push(new SystemMessage(message.content));
        }
      }
      forwardedPropsCopy.messages = newMessages;
    }

    return forwardedPropsCopy;
  }

  /**
   * Reads from the LangChainMessageStream and converts the output to a ReadableStream.
   *
   * @param streamedChain
   * @returns ReadableStream
   */
  streamResult(streamedChain: LangChainMessageStream): ReadableStream<any> {
    let reader = streamedChain.getReader();

    async function cleanup(controller?: ReadableStreamDefaultController<BaseMessageChunk>) {
      if (controller) {
        try {
          controller.close();
        } catch (_) {}
      }
      if (reader) {
        try {
          await reader.cancel();
        } catch (_) {}
      }
    }

    return new ReadableStream<any>({
      async pull(controller) {
        while (true) {
          try {
            const { done, value } = await reader.read();

            if (done) {
              writeChatCompletionEnd(controller);
              await cleanup(controller);
              return;
            }

            const toolCalls = value.lc_kwargs?.additional_kwargs?.tool_calls;
            const content = value?.lc_kwargs?.content;
            const chunk: ChatCompletionChunk = {
              choices: [
                {
                  delta: {
                    role: "assistant",
                    content: content,
                    ...(toolCalls ? { tool_calls: toolCalls } : {}),
                  },
                },
              ],
            };
            writeChatCompletionChunk(controller, chunk);
          } catch (error) {
            controller.error(error);
            await cleanup(controller);
            return;
          }
        }
      },
      cancel() {
        cleanup();
      },
    });
  }
}

/**
 * A ReadableStream that only emits a single chunk.
 */
class SingleChunkReadableStream extends ReadableStream<any> {
  constructor(content: string = "", toolCalls?: any) {
    super({
      start(controller) {
        const chunk: ChatCompletionChunk = {
          choices: [
            {
              delta: {
                role: "assistant",
                content,
                ...(toolCalls ? { tool_calls: toolCalls } : {}),
              },
            },
          ],
        };
        writeChatCompletionChunk(controller, chunk);
        writeChatCompletionEnd(controller);

        controller.close();
      },
      cancel() {},
    });
  }
}
