import { Anthropic } from "@anthropic-ai/sdk";
import { ActionInput } from "../../graphql/inputs/action.input";
import { Message } from "../../graphql/types/converted";

export function limitMessagesToTokenCount(
  messages: any[],
  tools: any[],
  model: string,
  maxTokens?: number,
): any[] {
  maxTokens ||= MAX_TOKENS;

  const result: any[] = [];
  const toolsNumTokens = countToolsTokens(model, tools);
  if (toolsNumTokens > maxTokens) {
    throw new Error(
      `Too many tokens in function definitions: ${toolsNumTokens} > ${maxTokens}`,
    );
  }
  maxTokens -= toolsNumTokens;

  for (const message of messages) {
    if (message.role === "system") {
      const numTokens = countMessageTokens(model, message);
      maxTokens -= numTokens;

      if (maxTokens < 0) {
        throw new Error("Not enough tokens for system message.");
      }
    }
  }

  let cutoff: boolean = false;

  const reversedMessages = [...messages].toReversed();
  for (const message of reversedMessages) {
    if (message.role === "system") {
      result.unshift(message);
      continue;
    } else if (cutoff) {
      continue;
    }
    let numTokens = countMessageTokens(model, message);
    if (maxTokens < numTokens) {
      cutoff = true;
      continue;
    }
    result.unshift(message);
    maxTokens -= numTokens;
  }

  // Post-process: remove orphaned tool_result and tool_use blocks.
  // Token trimming may have removed the assistant message containing tool_use
  // while keeping the user message with tool_result (or vice versa),
  // which Anthropic rejects.

  // Collect all tool_use IDs from assistant messages
  const toolUseIds = new Set<string>();
  for (const msg of result) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          toolUseIds.add(block.id);
        }
      }
    }
  }

  // Collect all tool_result IDs from user messages
  const toolResultIds = new Set<string>();
  for (const msg of result) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          toolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  // Filter orphaned blocks without mutating the original messages
  const filtered: any[] = [];
  for (const msg of result) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const remaining = msg.content.filter(
        (block: any) =>
          block.type !== "tool_result" || toolUseIds.has(block.tool_use_id),
      );
      if (remaining.length === 0) continue;
      if (remaining.length !== msg.content.length) {
        filtered.push({ ...msg, content: remaining });
      } else {
        filtered.push(msg);
      }
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const remaining = msg.content.filter(
        (block: any) =>
          block.type !== "tool_use" || toolResultIds.has(block.id),
      );
      if (remaining.length === 0) continue;
      if (remaining.length !== msg.content.length) {
        filtered.push({ ...msg, content: remaining });
      } else {
        filtered.push(msg);
      }
    } else {
      filtered.push(msg);
    }
  }

  return filtered;
}

const MAX_TOKENS = 128000;

function countToolsTokens(model: string, tools: any[]): number {
  if (tools.length === 0) {
    return 0;
  }
  const json = JSON.stringify(tools);
  return countTokens(model, json);
}

function countMessageTokens(model: string, message: any): number {
  return countTokens(model, JSON.stringify(message.content) || "");
}

function countTokens(model: string, text: string): number {
  return text.length / 3;
}

export function convertActionInputToAnthropicTool(
  action: ActionInput,
): Anthropic.Messages.Tool {
  return {
    name: action.name,
    description: action.description,
    input_schema: JSON.parse(action.jsonSchema),
  };
}

export function convertMessageToAnthropicMessage(
  message: Message,
): Anthropic.Messages.MessageParam {
  if (message.isTextMessage()) {
    if (message.role === "system") {
      return {
        role: "assistant",
        content: [
          {
            type: "text",
            text:
              "THE FOLLOWING MESSAGE IS A SYSTEM MESSAGE: " + message.content,
          },
        ],
      };
    } else {
      return {
        role: message.role === "user" ? "user" : "assistant",
        content: [{ type: "text", text: message.content }],
      };
    }
  } else if (message.isImageMessage()) {
    let mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    switch (message.format) {
      case "jpeg":
        mediaType = "image/jpeg";
        break;
      case "png":
        mediaType = "image/png";
        break;
      case "webp":
        mediaType = "image/webp";
        break;
      case "gif":
        mediaType = "image/gif";
        break;
      default:
        throw new Error(`Unsupported image format: ${message.format}`);
    }

    return {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: message.bytes,
          },
        },
      ],
    };
  } else if (message.isActionExecutionMessage()) {
    return {
      role: "assistant",
      content: [
        {
          id: message.id,
          type: "tool_use",
          input: message.arguments,
          name: message.name,
        },
      ],
    };
  } else if (message.isResultMessage()) {
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
}
