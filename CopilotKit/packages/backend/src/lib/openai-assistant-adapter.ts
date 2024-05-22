/**
 * CopilotKit Adapter for the OpenAI Assistant API.
 *
 * Use this adapter to get responses from the OpenAI Assistant API.
 *
 * <RequestExample>
 * ```typescript
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new OpenAIAssistantAdapter({
 *    assistantId: "your-assistant-id"
 *   })
 * );
 * ```
 * </RequestExample>
 */
import OpenAI from "openai";
import { CopilotKitServiceAdapter, CopilotKitResponse } from "../types/service-adapter";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../utils/openai";
import { ChatCompletionChunk, Message } from "@copilotkit/shared";

const RUN_STATUS_POLL_INTERVAL = 100;

export interface OpenAIAssistantAdapterParams {
  /**
   * The ID of the assistant to use.
   */
  assistantId: string;

  /**
   * An instance of `OpenAI` to use for the request. If not provided, a new instance will be created.
   */
  openai?: OpenAI;

  /**
   * Whether to enable the code interpreter. Defaults to `true`.
   */
  codeInterpreterEnabled?: boolean;

  /**
   * Whether to enable retrieval. Defaults to `true`.
   */
  retrievalEnabled?: boolean;
}

export class OpenAIAssistantAdapter implements CopilotKitServiceAdapter {
  private openai: OpenAI;
  private codeInterpreterEnabled: boolean;
  private assistantId: string;
  private retrievalEnabled: boolean;

  constructor(params: OpenAIAssistantAdapterParams) {
    this.openai = params.openai || new OpenAI({});
    this.codeInterpreterEnabled = params.codeInterpreterEnabled === false || true;
    this.retrievalEnabled = params.retrievalEnabled === false || true;
    this.assistantId = params.assistantId;
  }

  private async waitForRun(
    run: OpenAI.Beta.Threads.Runs.Run,
  ): Promise<OpenAI.Beta.Threads.Runs.Run> {
    while (true) {
      const status = await this.openai.beta.threads.runs.retrieve(run.thread_id, run.id);
      if (status.status === "completed" || status.status === "requires_action") {
        return status;
      } else if (status.status !== "in_progress" && status.status !== "queued") {
        console.error(`Thread run failed with status: ${status.status}`);
        throw new Error(`Thread run failed with status: ${status.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, RUN_STATUS_POLL_INTERVAL));
    }
  }

  private async submitToolOutputs(threadId: string, runId: string, forwardMessages: Message[]) {
    let run = await this.openai.beta.threads.runs.retrieve(threadId, runId);

    if (!run.required_action) {
      throw new Error("No tool outputs required");
    }

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

    const toolCallsIds = run.required_action.submit_tool_outputs.tool_calls.map(
      (toolCall) => toolCall.id,
    );

    if (toolCallsIds.length != functionResults.length) {
      throw new Error("Number of function results does not match the number of tool calls");
    }

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

    run = await this.openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: toolOutputs,
    });

    return await this.waitForRun(run);
  }

  private async submitUserMessage(threadId: string, forwardedProps: any) {
    const forwardMessages = forwardedProps.messages || [];

    const message = forwardMessages[forwardMessages.length - 1];
    await this.openai.beta.threads.messages.create(threadId, {
      role: message.role as "user",
      content: message.content,
    });

    const tools = [
      ...(forwardedProps.tools || []),
      ...(this.codeInterpreterEnabled ? [{ type: "code_interpreter" }] : []),
      ...(this.retrievalEnabled ? [{ type: "retrieval" }] : []),
    ];

    // build instructions by joining all system messages
    const instructions = forwardMessages
      .filter((message: Message) => message.role === "system")
      .map((message: Message) => message.content)
      .join("\n\n");

    // run the thread
    let run = await this.openai.beta.threads.runs.create(threadId, {
      assistant_id: this.assistantId,
      instructions,
      tools: tools,
    });

    return await this.waitForRun(run);
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

    let run: OpenAI.Beta.Threads.Runs.Run | null = null;

    // submit function outputs
    if (
      forwardMessages.length > 0 &&
      forwardMessages[forwardMessages.length - 1].role === "function"
    ) {
      run = await this.submitToolOutputs(threadId, forwardedProps.runId, forwardMessages);
    }
    // submit user message
    else if (
      forwardMessages.length > 0 &&
      forwardMessages[forwardMessages.length - 1].role === "user"
    ) {
      run = await this.submitUserMessage(threadId, forwardedProps);
    }
    // unsupported message
    else {
      console.error("No actionable message found in the messages");
      throw new Error("No actionable message found in the messages");
    }

    if (run.status === "requires_action") {
      // return the tool calls
      return {
        stream: new AssistantSingleChunkReadableStream(
          "",
          run.required_action!.submit_tool_outputs.tool_calls,
        ),
        headers: { threadId, runId: run.id },
      };
    } else {
      // return the last message
      const newMessages = await this.openai.beta.threads.messages.list(threadId, {
        limit: 1,
        order: "desc",
      });

      const content = newMessages.data[0].content[0];
      const contentString = content.type === "text" ? content.text.value : "";

      return {
        stream: new AssistantSingleChunkReadableStream(contentString),
        headers: { threadId },
      };
    }
  }
}

class AssistantSingleChunkReadableStream extends ReadableStream<any> {
  constructor(
    content: string,
    toolCalls?: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[],
  ) {
    super({
      start(controller) {
        let tool_calls: any = undefined;
        if (toolCalls) {
          tool_calls = toolCalls.map((toolCall, index) => {
            return {
              index,
              id: toolCall.id,
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            };
          });
        }
        const chunk: ChatCompletionChunk = {
          choices: [
            {
              delta: {
                content: content,
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
