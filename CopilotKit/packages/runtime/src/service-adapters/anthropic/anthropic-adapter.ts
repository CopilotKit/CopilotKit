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
 * return new AnthropicAdapter({
 *   anthropic,
 *   promptCaching: {
 *     enabled: true,
 *     debug: true
 *   }
 * });
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
  limitMessagesToTokenCount,
} from "./utils";

import { randomId, randomUUID } from "@copilotkit/shared";
import { convertServiceAdapterError } from "../shared";

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

export interface AnthropicPromptCachingConfig {
  /**
   * Whether to enable prompt caching.
   */
  enabled: boolean;

  /**
   * Whether to enable debug logging for cache operations.
   */
  debug?: boolean;
}

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

  /**
   * Configuration for prompt caching.
   * See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   */
  promptCaching?: AnthropicPromptCachingConfig;
}

export class AnthropicAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;
  private promptCaching: AnthropicPromptCachingConfig;

  private _anthropic: Anthropic;
  public get anthropic(): Anthropic {
    return this._anthropic;
  }

  constructor(params?: AnthropicAdapterParams) {
    this._anthropic = params?.anthropic || new Anthropic({});
    if (params?.model) {
      this.model = params.model;
    }
    this.promptCaching = params?.promptCaching || { enabled: false };
  }

  /**
   * Adds cache control to system prompt
   */
  private addSystemPromptCaching(
    system: string,
    debug: boolean = false,
  ): string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
    if (!this.promptCaching.enabled || !system) {
      return system;
    }

    const originalTextLength = system.length;

    if (debug) {
      console.log(
        `[ANTHROPIC CACHE DEBUG] Added cache control to system prompt (${originalTextLength} chars).`,
      );
    }

    return [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  /**
   * Adds cache control to the final message
   */
  private addIncrementalMessageCaching(
    messages: Anthropic.Messages.MessageParam[],
    debug: boolean = false,
  ): any[] {
    if (!this.promptCaching.enabled || messages.length === 0) {
      return messages;
    }

    const finalMessage = messages[messages.length - 1];
    const messageNumber = messages.length;

    if (Array.isArray(finalMessage.content) && finalMessage.content.length > 0) {
      const finalBlock = finalMessage.content[finalMessage.content.length - 1];

      const updatedMessages = [
        ...messages.slice(0, -1),
        {
          ...finalMessage,
          content: [
            ...finalMessage.content.slice(0, -1),
            { ...finalBlock, cache_control: { type: "ephemeral" } } as any,
          ],
        },
      ];

      if (debug) {
        console.log(
          `[ANTHROPIC CACHE DEBUG] Added cache control to final message (message ${messageNumber}).`,
        );
      }

      return updatedMessages;
    }

    return messages;
  }

  private shouldGenerateFallbackResponse(messages: Anthropic.Messages.MessageParam[]): boolean {
    if (messages.length === 0) return false;

    const lastMessage = messages[messages.length - 1];

    // Check if the last message is a tool result
    const endsWithToolResult =
      lastMessage.role === "user" &&
      Array.isArray(lastMessage.content) &&
      lastMessage.content.some((content: any) => content.type === "tool_result");

    // Also check if we have a recent pattern of user message -> assistant tool use -> user tool result
    // This indicates a completed action that might not need a response
    if (messages.length >= 3 && endsWithToolResult) {
      const lastThree = messages.slice(-3);
      const hasRecentToolPattern =
        lastThree[0]?.role === "user" && // Initial user message
        lastThree[1]?.role === "assistant" && // Assistant tool use
        Array.isArray(lastThree[1].content) &&
        lastThree[1].content.some((content: any) => content.type === "tool_use") &&
        lastThree[2]?.role === "user" && // Tool result
        Array.isArray(lastThree[2].content) &&
        lastThree[2].content.some((content: any) => content.type === "tool_result");

      return hasRecentToolPattern;
    }

    return endsWithToolResult;
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

    // ALLOWLIST APPROACH:
    // 1. First, identify all valid tool_use calls (from assistant)
    // 2. Then, only keep tool_result blocks that correspond to these valid tool_use IDs
    // 3. Discard any other tool_result blocks

    // Step 1: Extract valid tool_use IDs
    const validToolUseIds = new Set<string>();

    for (const message of messages) {
      if (message.isActionExecutionMessage()) {
        validToolUseIds.add(message.id);
      }
    }

    // Step 2: Map each message to an Anthropic message, eliminating invalid tool_results
    const processedToolResultIds = new Set<string>();
    const anthropicMessages = messages
      .map((message) => {
        // For tool results, only include if they match a valid tool_use ID AND haven't been processed
        if (message.isResultMessage()) {
          // Skip if there's no corresponding tool_use
          if (!validToolUseIds.has(message.actionExecutionId)) {
            return null; // Will be filtered out later
          }

          // Skip if we've already processed a result for this tool_use ID
          if (processedToolResultIds.has(message.actionExecutionId)) {
            return null; // Will be filtered out later
          }

          // Mark this tool result as processed
          processedToolResultIds.add(message.actionExecutionId);

          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                content: message.result || "Action completed successfully",
                tool_use_id: message.actionExecutionId,
              },
            ],
          };
        }

        // For non-tool-result messages, convert normally
        return convertMessageToAnthropicMessage(message);
      })
      .filter(Boolean) // Remove nulls
      .filter((msg) => {
        // Filter out assistant messages with empty text content
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const hasEmptyTextOnly =
            msg.content.length === 1 &&
            msg.content[0].type === "text" &&
            (!(msg.content[0] as any).text || (msg.content[0] as any).text.trim() === "");

          // Keep messages that have tool_use or non-empty text
          return !hasEmptyTextOnly;
        }
        return true;
      }) as Anthropic.Messages.MessageParam[];

    // Apply token limits
    const limitedMessages = limitMessagesToTokenCount(anthropicMessages, tools, model);

    // Apply prompt caching if enabled
    const cachedSystemPrompt = this.addSystemPromptCaching(instructions, this.promptCaching.debug);
    const cachedMessages = this.addIncrementalMessageCaching(
      limitedMessages,
      this.promptCaching.debug,
    );

    // We'll check if we need a fallback response after seeing what Anthropic returns
    // We skip grouping by role since we've already ensured uniqueness of tool_results

    let toolChoice: any = forwardedParameters?.toolChoice;
    if (forwardedParameters?.toolChoice === "function") {
      toolChoice = {
        type: "tool",
        name: forwardedParameters.toolChoiceFunctionName,
      };
    }

    try {
      const createParams = {
        system: cachedSystemPrompt,
        model: this.model,
        messages: cachedMessages,
        max_tokens: forwardedParameters?.maxTokens || 1024,
        ...(forwardedParameters?.temperature
          ? { temperature: forwardedParameters.temperature }
          : {}),
        ...(tools.length > 0 && { tools }),
        ...(toolChoice && { tool_choice: toolChoice }),
        stream: true,
      };

      const stream = await this.anthropic.messages.create(createParams);

      eventSource.stream(async (eventStream$) => {
        let mode: "function" | "message" | null = null;
        let didOutputText = false;
        let currentMessageId = randomId();
        let currentToolCallId = randomId();
        let filterThinkingTextBuffer = new FilterThinkingTextBuffer();
        let hasReceivedContent = false;

        try {
          for await (const chunk of stream as AsyncIterable<any>) {
            if (chunk.type === "message_start") {
              currentMessageId = chunk.message.id;
            } else if (chunk.type === "content_block_start") {
              hasReceivedContent = true;
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
        } catch (error) {
          throw convertServiceAdapterError(error, "Anthropic");
        }

        // Generate fallback response only if Anthropic produced no content
        if (!hasReceivedContent && this.shouldGenerateFallbackResponse(cachedMessages)) {
          // Extract the tool result content for a more contextual response
          let fallbackContent = "Task completed successfully.";
          const lastMessage = cachedMessages[cachedMessages.length - 1];
          if (lastMessage?.role === "user" && Array.isArray(lastMessage.content)) {
            const toolResult = lastMessage.content.find((c: any) => c.type === "tool_result");
            if (toolResult?.content && toolResult.content !== "Action completed successfully") {
              fallbackContent = toolResult.content;
            }
          }

          currentMessageId = randomId();
          eventStream$.sendTextMessageStart({ messageId: currentMessageId });
          eventStream$.sendTextMessageContent({
            messageId: currentMessageId,
            content: fallbackContent,
          });
          eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
        }

        eventStream$.complete();
      });
    } catch (error) {
      throw convertServiceAdapterError(error, "Anthropic");
    }

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
