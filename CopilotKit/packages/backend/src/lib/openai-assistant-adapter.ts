import OpenAI from "openai";
import {
  CopilotKitServiceAdapter,
  CopilotKitServiceAdapterReturnType,
} from "../types/service-adapter";
import {
  limitOpenAIMessagesToTokenCount,
  maxTokensForOpenAIModel,
  writeChatCompletionChunk,
  writeChatCompletionEnd,
} from "../utils/openai";
import { ChatCompletionChunk, Message } from "@copilotkit/shared";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export interface OpenAIAdapterParams {
  assistantId: string;
  openai?: OpenAI;
  model?: string;
  codeInterpreterEnabled?: boolean;
  retrievalEnabled?: boolean;
}

export class OpenAIAdapter implements CopilotKitServiceAdapter {
  private openai: OpenAI;
  private model: string = DEFAULT_MODEL;
  private codeInterpreterEnabled: boolean;
  private assistantId: string;
  private retrievalEnabled: boolean;

  constructor(params?: OpenAIAdapterParams) {
    this.openai = params?.openai || new OpenAI({});
    if (params?.model) {
      this.model = params.model;
    }
    this.codeInterpreterEnabled = params?.codeInterpreterEnabled === false || true;
    this.retrievalEnabled = params?.retrievalEnabled === false || true;
    this.assistantId = params.assistantId;
  }

  async stream(forwardedProps: any): Promise<CopilotKitServiceAdapterReturnType> {
    // copy forwardedProps to avoid modifying the original object
    forwardedProps = { ...forwardedProps };

    // Remove tools if there are none to avoid OpenAI API errors
    // when sending an empty array of tools
    if (forwardedProps.tools && forwardedProps.tools.length === 0) {
      delete forwardedProps.tools;
    }

    // get the thread from forwardedProps or create a new one
    const threadId: string =
      forwardedProps.threadId || (await this.openai.beta.threads.create()).id;

    const threadMessages = await this.openai.beta.threads.messages.list(threadId, {
      limit: 20,
      order: "desc",
    });

    // retrieve the last 20 messages that are already in the thread
    const threadMessageIds = threadMessages.data.map(
      // in case of messages we added, the messagesId will be set by us in metadata
      // otherwise, we use the message id from openai
      (message) => (message.metadata as any)?.messageId || message.id,
    );

    const messages = (forwardedProps.messages || []).filter((message: Message) => {
      // we do not send the system message, instead we use it as instructions
      if (message.role === "system") {
        return false;
      }
      return !threadMessageIds.includes(message.id);
    });

    // build instructions by joining all system messages
    const instructions = (forwardedProps.messages || [])
      .filter((message: Message) => message.role === "system")
      .map((message: Message) => message.content)
      .join("\n\n");

    // append all missing messages to the thread
    for (const message of messages) {
      await this.openai.beta.threads.messages.create(threadId, {
        role: message.role,
        content: message.content,
        metadata: {
          messageId: message.id,
        },
      });
    }

    const tools = [
      ...(forwardedProps.tools || []),
      ...(this.codeInterpreterEnabled ? [{ type: "code_interpreter" }] : []),
    ];

    // run the thread
    const run = await this.openai.beta.threads.runs.create(threadId, {
      assistant_id: this.assistantId,
      model: this.model,
      instructions,
      tools: tools,
    });

    // wether the thread contains function calls
    let requiredAction: OpenAI.Beta.Threads.Runs.Run.RequiredAction | null = null;

    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const status = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
      if (status.status === "completed") {
        break;
      } else if (status.status === "requires_action") {
        requiredAction = status.required_action;
        break;
      } else if (status.status !== "in_progress" && status.status !== "queued") {
        throw new Error(`Thread run failed with status: ${status.status}`);
      }
    } while (true);

    if (requiredAction) {
      return {
        stream: new SingleChunkToolCallReadableStream(
          requiredAction.submit_tool_outputs.tool_calls,
        ),
        headers: { threadId },
      };
    } else {
      // figure out the messages to return
      const newMessages = await this.openai.beta.threads.messages.list(threadId, {
        limit: 20,
        order: "desc",
      });

      const existingMessageIds = (forwardedProps.messages || []).map(
        (message: Message) => message.id,
      );

      const messagesToReturn = newMessages.data.filter(
        (message) => !existingMessageIds.includes(message.id),
      );

      // return the messages as a single chunk
      return {
        stream: new SingleChunkTextMessageReadableStream(messagesToReturn),
        headers: { threadId },
      };
    }
  }
}

class SingleChunkToolCallReadableStream extends ReadableStream<any> {
  constructor(toolCalls: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[]) {
    super({
      start(controller) {
        const tool_calls = toolCalls.map((toolCall, index) => {
          return {
            index,
            id: toolCall.id,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          };
        });

        const chunk: ChatCompletionChunk = {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls,
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

class SingleChunkTextMessageReadableStream extends ReadableStream<any> {
  constructor(messages: OpenAI.Beta.Threads.Messages.ThreadMessage[]) {
    super({
      start(controller) {
        for (const message of messages) {
          for (const content of message.content) {
            if (content.type === "text") {
              const chunk: ChatCompletionChunk = {
                choices: [
                  {
                    delta: {
                      role: message.role,
                      content: content.text.value,
                      // ...(toolCalls ? { tool_calls: toolCalls } : {}),
                    },
                  },
                ],
              };
              writeChatCompletionChunk(controller, chunk);
            }
          }
        }
        writeChatCompletionEnd(controller);

        controller.close();
      },
      cancel() {},
    });
  }
}
