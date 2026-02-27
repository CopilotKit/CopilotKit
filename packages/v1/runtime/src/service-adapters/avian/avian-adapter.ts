/**
 * Copilot Runtime adapter for the Avian LLM API.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, AvianAdapter } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new AvianAdapter({ model: "deepseek/deepseek-v3.2" });
 * ```
 *
 * The adapter uses the `AVIAN_API_KEY` environment variable by default.
 * You can also pass an API key directly:
 *
 * ```ts
 * return new AvianAdapter({
 *   model: "deepseek/deepseek-v3.2",
 *   apiKey: "<your-api-key>",
 * });
 * ```
 *
 * Avian provides an OpenAI-compatible API with access to models from
 * multiple providers including DeepSeek, Moonshot, GLM, and MiniMax.
 *
 * Available models:
 * - `deepseek/deepseek-v3.2` (164K context)
 * - `moonshotai/kimi-k2.5` (131K context)
 * - `z-ai/glm-5` (131K context)
 * - `minimax/minimax-m2.5` (1M context)
 */
import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type OpenAI from "openai";
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
import { convertServiceAdapterError, getSdkClientOptions } from "../shared";

const DEFAULT_MODEL = "deepseek/deepseek-v3.2";
const AVIAN_BASE_URL = "https://api.avian.io/v1";

export interface AvianAdapterParams {
  /**
   * An optional OpenAI-compatible client instance to use.
   * If not provided, one will be created using the `AVIAN_API_KEY`
   * environment variable and the Avian API base URL.
   */
  openai?: OpenAI;

  /**
   * The Avian API key. If not provided, the `AVIAN_API_KEY` environment
   * variable will be used.
   */
  apiKey?: string;

  /**
   * The model to use.
   *
   * @default "deepseek/deepseek-v3.2"
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

export class AvianAdapter implements CopilotServiceAdapter {
  public model: string = DEFAULT_MODEL;
  public provider = "avian";

  private disableParallelToolCalls: boolean = false;
  private _openai: OpenAI;
  private apiKey?: string;

  public get openai(): OpenAI {
    return this._openai;
  }
  public get name() {
    return "AvianAdapter";
  }

  constructor(params?: AvianAdapterParams) {
    if (params?.openai) {
      this._openai = params.openai;
    }
    this.apiKey = params?.apiKey;
    // If no instance provided, we'll lazy-load in ensureOpenAI()
    if (params?.model) {
      this.model = params.model;
    }
    this.disableParallelToolCalls = params?.disableParallelToolCalls || false;
  }

  getLanguageModel(): LanguageModel {
    const openai = this.ensureOpenAI();
    const options = getSdkClientOptions(openai);
    const provider = createOpenAI({
      baseURL: openai.baseURL,
      apiKey: openai.apiKey,
      headers: options.defaultHeaders,
      fetch: options.fetch,
      name: "avian",
    });
    return provider(this.model);
  }

  private ensureOpenAI(): OpenAI {
    if (!this._openai) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenAI = require("openai").default;
      this._openai = new OpenAI({
        apiKey: this.apiKey || process.env.AVIAN_API_KEY,
        baseURL: AVIAN_BASE_URL,
      });
    }
    return this._openai;
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
      const openai = this.ensureOpenAI();
      stream = await openai.chat.completions.create({
        model: model,
        stream: true,
        messages: openaiMessages,
        ...(tools.length > 0 && { tools }),
        ...(forwardedParameters?.maxTokens && {
          max_tokens: forwardedParameters.maxTokens,
        }),
        ...(forwardedParameters?.stop && { stop: forwardedParameters.stop }),
        ...(toolChoice && { tool_choice: toolChoice }),
        ...(this.disableParallelToolCalls && { parallel_tool_calls: false }),
        ...(forwardedParameters?.temperature && {
          temperature: forwardedParameters.temperature,
        }),
      });
    } catch (error) {
      throw convertServiceAdapterError(error, "Avian");
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
          } else if (
            mode === "function" &&
            (toolCall === undefined || toolCall?.id)
          ) {
            mode = null;
            eventStream$.sendActionExecutionEnd({
              actionExecutionId: currentToolCallId,
            });
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
              eventStream$.sendTextMessageStart({
                messageId: currentMessageId,
              });
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
          eventStream$.sendActionExecutionEnd({
            actionExecutionId: currentToolCallId,
          });
        }
      } catch (error) {
        throw convertServiceAdapterError(error, "Avian");
      }

      eventStream$.complete();
    });

    return {
      threadId: request.threadId || randomUUID(),
    };
  }
}
