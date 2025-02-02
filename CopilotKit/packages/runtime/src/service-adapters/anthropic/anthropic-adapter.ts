/**
 * Copilot Runtime adapter for Anthropic.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, AnthropicAdapter } from "@copilotkit/runtime";
 * import Anthropic from "@anthropic-ai/sdk";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const anthropic = new Anthropic({
 *   apiKey: "<your-api-key>",
 * });
 *
 * return new AnthropicAdapter({ anthropic });
 * ```
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import {
  convertActionInputToAnthropicTool,
  convertMessageToAnthropicMessage,
  groupAnthropicMessagesByRole,
  limitMessagesToTokenCount,
} from "./utils";

import { randomId, randomUUID } from "@copilotkit/shared";

const DEFAULT_MODEL = "claude-3-sonnet-20240229";

export interface AnthropicAdapterParams {
  /**
   * An optional Anthropic instance to use.  If not provided, a new instance will be
   * created.
   */
  anthropic?: Anthropic;

  /**
   * The model to use.
   */
  model?: string;
}

export class AnthropicAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private _anthropic: Anthropic;
  public get anthropic(): Anthropic {
    return this._anthropic;
  }

  constructor(params?: AnthropicAdapterParams) {
    this._anthropic = params?.anthropic || new Anthropic({});
    if (params?.model) {
      this.model = params.model;
    }
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const {
      threadId,
      model = this.model,
      messages: rawMessages,
      actions,
      eventSource,
      forwardedParameters,
    } = request;
    const tools = actions.map(convertActionInputToAnthropicTool);

    const messages = [...rawMessages];

    // get the instruction message
    const instructionsMessage = messages.shift();
    const instructions = instructionsMessage.isTextMessage() ? instructionsMessage.content : "";

    let anthropicMessages = messages.map(convertMessageToAnthropicMessage);
    anthropicMessages = limitMessagesToTokenCount(anthropicMessages, tools, model);
    anthropicMessages = groupAnthropicMessagesByRole(anthropicMessages);

    let toolChoice: any = forwardedParameters?.toolChoice;
    if (forwardedParameters?.toolChoice === "function") {
      toolChoice = {
        type: "tool",
        name: forwardedParameters.toolChoiceFunctionName,
      };
    }

    const stream = this.anthropic.messages.create({
      system: instructions,
      model: this.model,
      messages: anthropicMessages,
      max_tokens: forwardedParameters?.maxTokens || 1024,
      ...(forwardedParameters?.temperature ? { temperature: forwardedParameters.temperature } : {}),
      ...(tools.length > 0 && { tools }),
      ...(toolChoice && { tool_choice: toolChoice }),
      stream: true,
    });

    eventSource.stream(async (eventStream$) => {
      let mode: "function" | "message" | null = null;
      let didOutputText = false;
      let currentMessageId = randomId();
      let currentToolCallId = randomId();
      let filterThinkingTextBuffer = new FilterThinkingTextBuffer();

      for await (const chunk of await stream) {
        if (chunk.type === "message_start") {
          currentMessageId = chunk.message.id;
        } else if (chunk.type === "content_block_start") {
          if (chunk.content_block.type === "text") {
            didOutputText = false;
            filterThinkingTextBuffer.reset();
            mode = "message";
          } else if (chunk.content_block.type === "tool_use") {
            currentToolCallId = chunk.content_block.id;
            eventStream$.sendActionExecutionStart({
              actionExecutionId: currentToolCallId,
              actionName: chunk.content_block.name,
              parentMessageId: currentMessageId,
            });
            mode = "function";
          }
        } else if (chunk.type === "content_block_delta") {
          if (chunk.delta.type === "text_delta") {
            const text = filterThinkingTextBuffer.onTextChunk(chunk.delta.text);
            if (text.length > 0) {
              if (!didOutputText) {
                eventStream$.sendTextMessageStart({ messageId: currentMessageId });
                didOutputText = true;
              }
              eventStream$.sendTextMessageContent({
                messageId: currentMessageId,
                content: text,
              });
            }
          } else if (chunk.delta.type === "input_json_delta") {
            eventStream$.sendActionExecutionArgs({
              actionExecutionId: currentToolCallId,
              args: chunk.delta.partial_json,
            });
          }
        } else if (chunk.type === "content_block_stop") {
          if (mode === "message") {
            if (didOutputText) {
              eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
            }
          } else if (mode === "function") {
            eventStream$.sendActionExecutionEnd({ actionExecutionId: currentToolCallId });
          }
        }
      }

      eventStream$.complete();
    });

    return {
      threadId: threadId || randomUUID(),
    };
  }
}

const THINKING_TAG = "<thinking>";
const THINKING_TAG_END = "</thinking>";

class FilterThinkingTextBuffer {
  private buffer: string;
  private didFilterThinkingTag: boolean = false;

  constructor() {
    this.buffer = "";
  }

  onTextChunk(text: string): string {
    this.buffer += text;
    if (this.didFilterThinkingTag) {
      return text;
    }
    const potentialTag = this.buffer.slice(0, THINKING_TAG.length);
    if (THINKING_TAG.startsWith(potentialTag)) {
      if (this.buffer.includes(THINKING_TAG_END)) {
        const end = this.buffer.indexOf(THINKING_TAG_END);
        const filteredText = this.buffer.slice(end + THINKING_TAG_END.length);
        this.buffer = filteredText;
        this.didFilterThinkingTag = true;
        return filteredText;
      } else {
        return "";
      }
    }
    return text;
  }

  reset() {
    this.buffer = "";
    this.didFilterThinkingTag = false;
  }
}
