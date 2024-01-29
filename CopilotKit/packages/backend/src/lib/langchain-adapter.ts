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

export type LangChainMessageStream = IterableReadableStream<BaseMessageChunk>;

interface LangChainAdapterStreamProps {
  streamChain: (forwardedProps: any) => Promise<LangChainMessageStream>;
}

export class LangChainAdapter implements CopilotKitServiceAdapter {
  streamChainFn?: (forwardedProps: any) => Promise<LangChainMessageStream>;

  constructor(props: LangChainAdapterStreamProps) {
    this.streamChainFn = props.streamChain;
  }

  async stream(forwardedProps: any): Promise<ReadableStream<any>> {
    // make a copy of forwardedProps so we can modify it
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

    // TODO: support calling invoke() too
    const streamedChain = await this.streamChainFn!(forwardedPropsCopy);

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
              const payload = new TextEncoder().encode("data: [DONE]\n\n");
              controller.enqueue(payload);
              await cleanup(controller);
              return;
            }

            const functionCall = value.lc_kwargs?.additional_kwargs?.function_call;

            // write a function call chunk
            if (functionCall) {
              const name = functionCall.name;
              const args = functionCall.arguments;
              const chunk: ChatCompletionChunk = {
                choices: [
                  {
                    delta: {
                      role: "assistant",
                      content: "",
                      function_call: {
                        name: name || "",
                        arguments: args || "",
                      },
                    },
                  },
                ],
              };

              const payload = new TextEncoder().encode("data: " + JSON.stringify(chunk) + "\n\n");
              controller.enqueue(payload);
              continue;
            }
            // write a text chunk
            else {
              const content = value?.lc_kwargs?.content;
              const chunk: ChatCompletionChunk = {
                choices: [
                  {
                    delta: {
                      role: "assistant",
                      content: content || "",
                    },
                  },
                ],
              };

              const payload = new TextEncoder().encode("data: " + JSON.stringify(chunk) + "\n\n");
              controller.enqueue(payload);
              continue;
            }
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
