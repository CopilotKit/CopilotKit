import OpenAI from "openai";
import { CopilotKitServiceAdapter, CopilotKitResponse } from "../types/service-adapter";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../utils/openai";
import { ChatCompletionChunk, Message } from "@copilotkit/shared";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export interface OpenAIAssistantAdapterParams {
  assistantId: string;
  openai?: OpenAI;
  model?: string;
  codeInterpreterEnabled?: boolean;
  retrievalEnabled?: boolean;
}

export class OpenAIAssistantAdapter implements CopilotKitServiceAdapter {
  private openai: OpenAI;
  private model: string = DEFAULT_MODEL;
  private codeInterpreterEnabled: boolean;
  private assistantId: string;
  private retrievalEnabled: boolean;

  constructor(params: OpenAIAssistantAdapterParams) {
    this.openai = params.openai || new OpenAI({});
    if (params.model) {
      this.model = params.model;
    }
    this.codeInterpreterEnabled = params.codeInterpreterEnabled === false || true;
    this.retrievalEnabled = params.retrievalEnabled === false || true;
    this.assistantId = params.assistantId;
  }

  async getResponse(forwardedProps: any): Promise<CopilotKitResponse> {
    // copy forwardedProps to avoid modifying the original object
    forwardedProps = { ...forwardedProps };

    const forwardMessages = forwardedProps.messages || [];

    // Remove tools if there are none to avoid OpenAI API errors
    // when sending an empty array of tools
    if (forwardedProps.tools && forwardedProps.tools.length === 0) {
      delete forwardedProps.tools;
    }

    // get the thread from forwardedProps or create a new one
    const threadId: string =
      forwardedProps.threadId || (await this.openai.beta.threads.create()).id;

    // build instructions by joining all system messages
    const instructions = forwardMessages
      .filter((message: Message) => message.role === "system")
      .map((message: Message) => message.content)
      .join("\n\n");

    let run: OpenAI.Beta.Threads.Runs.Run | null = null;

    // do we need to submit function outputs?
    if (
      forwardMessages.length > 0 &&
      forwardMessages[forwardMessages.length - 1].role === "function" &&
      forwardedProps.runId
    ) {
      const status = await this.openai.beta.threads.runs.retrieve(threadId, forwardedProps.runId);

      const functionResults: Message[] = [];
      // get all function results at the tail of the messages
      let i = forwardMessages.length - 1;
      for (; i >= 0; i--) {
        if (forwardMessages[i].role === "function") {
          functionResults.unshift(forwardMessages[i]);
        } else {
          break;
        }
      }

      const toolCallsIds =
        status.required_action?.submit_tool_outputs.tool_calls.map((toolCall) => toolCall.id) || [];

      // throw an error if the number of function results is greater than the number of tool calls
      if (toolCallsIds.length >= functionResults.length) {
        const toolOutputs: any[] = [];

        // match tool ids with function results
        for (let i = 0; i < functionResults.length; i++) {
          const toolCallId = toolCallsIds[i];
          const functionResult = functionResults[i];
          toolOutputs.push({
            tool_call_id: toolCallId,
            output: functionResult.content || "",
          });
        }

        run = await this.openai.beta.threads.runs.submitToolOutputs(
          threadId,
          forwardedProps.runId,
          {
            tool_outputs: toolOutputs,
          },
        );
      }
    }

    // TODO make it obvious what we are doing here
    if (!run) {
      // append all missing messages to the thread
      if (
        forwardMessages.length > 0 &&
        forwardMessages[forwardMessages.length - 1].role === "user"
      ) {
        const message = forwardMessages[forwardMessages.length - 1];

        await this.openai.beta.threads.messages.create(threadId, {
          role: message.role,
          content: message.content,
        });
      } else {
        throw new Error("No user message found in the messages");
      }

      const tools = [
        ...(forwardedProps.tools || []),
        ...(this.codeInterpreterEnabled ? [{ type: "code_interpreter" }] : []),
        ...(this.retrievalEnabled ? [{ type: "retrieval" }] : []),
      ];

      // run the thread
      run = await this.openai.beta.threads.runs.create(threadId, {
        assistant_id: this.assistantId,
        model: this.model,
        instructions,
        tools: tools,
      });
    }

    // do we need a function call?
    let requiredAction: OpenAI.Beta.Threads.Runs.Run.RequiredAction | null = null;

    do {
      // this will go once the API supports streaming
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
        headers: { threadId, runId: run.id },
      };
    } else {
      // return the last message
      const newMessages = await this.openai.beta.threads.messages.list(threadId, {
        limit: 1,
        order: "desc",
      });

      // return the messages as a single chunk
      return {
        stream: new SingleChunkTextMessageReadableStream(newMessages.data[0]),
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
  constructor(message: OpenAI.Beta.Threads.Messages.ThreadMessage) {
    super({
      start(controller) {
        const chunk: ChatCompletionChunk = {
          choices: [
            {
              delta: {
                id: message.id,
                role: message.role,
                content: message.content[0].type === "text" ? message.content[0].text.value : "",
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
