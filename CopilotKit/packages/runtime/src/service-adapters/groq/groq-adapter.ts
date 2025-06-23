/**
 * Copilot Runtime adapter for Groq.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, GroqAdapter } from "@copilotkit/runtime";
 * import { Groq } from "groq-sdk";
 *
 * const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new GroqAdapter({ groq, model: "<model-name>" });
 * ```
 */
import { Groq } from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import {
  convertActionInputToOpenAITool,
  convertMessageToOpenAIMessage,
  limitMessagesToTokenCount,
} from "../openai/utils";
import { randomUUID } from "@copilotkit/shared";
import { convertServiceAdapterError } from "../shared";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export interface GroqAdapterParams {
  /**
   * An optional Groq instance to use.
   */
  groq?: Groq;

  /**
   * The model to use.
   */
  model?: string;

  /**
   * Whether to disable parallel tool calls.
   * You can disable parallel tool calls to force the model to execute tool calls sequentially.
   * This is useful if you want to execute tool calls in a specific order so that the state changes
   * introduced by one tool call are visible to the next tool call. (i.e. new actions or readables)
   *
   * @default false
   */
  disableParallelToolCalls?: boolean;
}

export class GroqAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private disableParallelToolCalls: boolean = false;
  private _groq: Groq;
  public get groq(): Groq {
    return this._groq;
  }

  constructor(params?: GroqAdapterParams) {
    this._groq = params?.groq || new Groq({});
    if (params?.model) {
      this.model = params.model;
    }
    this.disableParallelToolCalls = params?.disableParallelToolCalls || false;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const {
      threadId,
      model = this.model,
      messages,
      actions,
      eventSource,
      forwardedParameters,
    } = request;
    const tools = actions.map(convertActionInputToOpenAITool);

    let openaiMessages = messages.map((m) =>
      convertMessageToOpenAIMessage(m, { keepSystemRole: true }),
    );
    openaiMessages = limitMessagesToTokenCount(openaiMessages, tools, model);

    let toolChoice: any = forwardedParameters?.toolChoice;
    if (forwardedParameters?.toolChoice === "function") {
      toolChoice = {
        type: "function",
        function: { name: forwardedParameters.toolChoiceFunctionName },
      };
    }
    let stream;
    try {
      stream = await this.groq.chat.completions.create({
        model: model,
        stream: true,
        messages: openaiMessages as unknown as ChatCompletionMessageParam[],
        ...(tools.length > 0 && { tools }),
        ...(forwardedParameters?.maxTokens && {
          max_tokens: forwardedParameters.maxTokens,
        }),
        ...(forwardedParameters?.stop && { stop: forwardedParameters.stop }),
        ...(toolChoice && { tool_choice: toolChoice }),
        ...(this.disableParallelToolCalls && { parallel_tool_calls: false }),
        ...(forwardedParameters?.temperature && { temperature: forwardedParameters.temperature }),
      });
    } catch (error) {
      throw convertServiceAdapterError(error, "Groq");
    }

    eventSource.stream(async (eventStream$) => {
      let mode: "function" | "message" | null = null;
      let currentMessageId: string;
      let currentToolCallId: string;

      try {
        for await (const chunk of stream) {
          const toolCall = chunk.choices[0].delta.tool_calls?.[0];
          const content = chunk.choices[0].delta.content;

          // When switching from message to function or vice versa,
          // send the respective end event.
          // If toolCall?.id is defined, it means a new tool call starts.
          if (mode === "message" && toolCall?.id) {
            mode = null;
            eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
          } else if (mode === "function" && (toolCall === undefined || toolCall?.id)) {
            mode = null;
            eventStream$.sendActionExecutionEnd({ actionExecutionId: currentToolCallId });
          }

          // If we send a new message type, send the appropriate start event.
          if (mode === null) {
            if (toolCall?.id) {
              mode = "function";
              currentToolCallId = toolCall!.id;
              eventStream$.sendActionExecutionStart({
                actionExecutionId: currentToolCallId,
                actionName: toolCall!.function!.name,
                parentMessageId: chunk.id,
              });
            } else if (content) {
              mode = "message";
              currentMessageId = chunk.id;
              eventStream$.sendTextMessageStart({ messageId: currentMessageId });
            }
          }

          // send the content events
          if (mode === "message" && content) {
            eventStream$.sendTextMessageContent({
              messageId: currentMessageId,
              content,
            });
          } else if (mode === "function" && toolCall?.function?.arguments) {
            eventStream$.sendActionExecutionArgs({
              actionExecutionId: currentToolCallId,
              args: toolCall.function.arguments,
            });
          }
        }

        // send the end events
        if (mode === "message") {
          eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
        } else if (mode === "function") {
          eventStream$.sendActionExecutionEnd({ actionExecutionId: currentToolCallId });
        }
      } catch (error) {
        throw convertServiceAdapterError(error, "Groq");
      }

      eventStream$.complete();
    });

    return {
      threadId: request.threadId || randomUUID(),
    };
  }
}
