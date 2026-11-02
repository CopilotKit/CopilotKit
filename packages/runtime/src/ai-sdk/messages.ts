import type { ContentPart, Message, ToolMessage } from "@ag-ui/client";
import { safeParseToolArgs } from "@copilotkit/shared";
import type {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  ModelMessage,
  SystemModelMessage,
  TextPart,
  ToolCallPart,
  ToolModelMessage,
  ToolResultPart,
  UserModelMessage,
} from "ai";

/** Warns that a part was dropped because it holds a provider file handle. */
function warnDroppedFileSource(what: string): void {
  console.warn(
    `[CopilotKit] Dropping a ${what} that references a provider file handle: it is not a URL or inline data, so it cannot be sent to the model here.`,
  );
}

/**
 * An AG-UI tool result as the AI SDK's tool result output.
 *
 * Providers hold one response per tool call, and the Google adapter emits one
 * functionResponse per text entry of a content list, so all of a result's text
 * is collected into a single entry: text parts run together, and a
 * URL-referenced part contributes the URL it carries on a line of its own —
 * the bytes are not here to hand over, and the reference is the content the
 * tool actually returned. A result with no inline media is that text alone.
 * One with inline media is a content list: the text entry first, when there is
 * any, then each media part with its bytes and media type. A media-only result
 * is media alone: a placeholder text would be content the tool never returned.
 * Which adapters can place media inside a tool response is theirs to decide.
 * A provider file handle (`file` source) is neither bytes nor a URL, and this
 * path cannot hand it to the provider, so the part is dropped with a warning.
 * A result whose parts were all dropped is the empty string, as AG-UI 1.0
 * requires: the call must still be answered.
 */
function toolResultOutput(
  content: ToolMessage["content"],
): ToolResultPart["output"] {
  if (typeof content === "string") return { type: "text", value: content };
  const segments: string[] = [];
  const media: Array<{ type: "media"; data: string; mediaType: string }> = [];
  let open = false; // whether the last segment is text still being appended to
  for (const part of content) {
    if (part.type === "text") {
      if (open) segments[segments.length - 1] += part.text;
      else segments.push(part.text);
      open = true;
    } else if (part.source.type === "file") {
      warnDroppedFileSource(`${part.type} part in a tool result`);
    } else if (part.source.type === "url") {
      segments.push(part.source.value);
      open = false;
    } else {
      media.push({
        type: "media",
        data: part.source.value,
        mediaType: part.source.mimeType,
      });
      open = false;
    }
  }
  const text = segments.join("\n");
  if (media.length === 0) return { type: "text", value: text };
  return {
    type: "content",
    value: [
      ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
      ...media,
    ],
  };
}

type LegacyBinaryInputContent = {
  type: "binary";
  mimeType?: string;
  data?: string;
  url?: string;
};

/**
 * Converts AG-UI user message content to Vercel AI SDK UserContent format.
 * Handles plain strings, new modality-specific parts (image/audio/video/document),
 * and legacy BinaryInputContent for backward compatibility.
 */
function convertUserMessageContent(
  content: string | Array<ContentPart | LegacyBinaryInputContent>,
): string | Array<TextPart | ImagePart | FilePart> {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  const parts: Array<TextPart | ImagePart | FilePart> = [];

  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) {
      continue;
    }

    switch (part.type) {
      case "text": {
        const text = (part as { text?: string }).text;
        if (text) {
          parts.push({ type: "text", text });
        }
        break;
      }

      case "image": {
        const source = (part as { source?: any }).source;
        if (!source) break;
        if (source.type === "data") {
          parts.push({
            type: "image",
            image: source.value,
            mediaType: source.mimeType,
          });
        } else if (source.type === "file") {
          warnDroppedFileSource("image part");
        } else if (source.type === "url") {
          try {
            parts.push({
              type: "image",
              image: new URL(source.value),
              mediaType: source.mimeType,
            });
          } catch {
            console.error(
              `[CopilotKit] convertUserMessageContent: invalid URL "${source.value}" in image part — skipping`,
            );
          }
        }
        break;
      }

      case "audio":
      case "video":
      case "document": {
        const source = (part as { source?: any }).source;
        if (!source) break;
        if (source.type === "data") {
          parts.push({
            type: "file",
            data: source.value,
            mediaType: source.mimeType,
          });
        } else if (source.type === "file") {
          warnDroppedFileSource(`${part.type} part`);
        } else if (source.type === "url") {
          try {
            parts.push({
              type: "file",
              data: new URL(source.value),
              mediaType: source.mimeType ?? "application/octet-stream",
            });
          } catch {
            console.error(
              `[CopilotKit] convertUserMessageContent: invalid URL "${source.value}" in ${part.type} part — skipping`,
            );
          }
        }
        break;
      }

      // Legacy BinaryInputContent backward compatibility
      case "binary": {
        const legacy = part;
        const mimeType = legacy.mimeType ?? "application/octet-stream";
        const isImage = mimeType.startsWith("image/");

        if (legacy.data) {
          if (isImage) {
            parts.push({
              type: "image",
              image: legacy.data,
              mediaType: mimeType,
            });
          } else {
            parts.push({
              type: "file",
              data: legacy.data,
              mediaType: mimeType,
            });
          }
        } else if (legacy.url) {
          try {
            const url = new URL(legacy.url);
            if (isImage) {
              parts.push({ type: "image", image: url, mediaType: mimeType });
            } else {
              parts.push({ type: "file", data: url, mediaType: mimeType });
            }
          } catch {
            console.error(
              `[CopilotKit] convertUserMessageContent: invalid URL "${legacy.url}" in binary part — skipping`,
            );
          }
        }
        break;
      }

      default: {
        console.error(
          `[CopilotKit] convertUserMessageContent: unrecognized content part type "${(part as { type: string }).type}" — skipping`,
        );
        break;
      }
    }
  }

  return parts.length > 0 ? parts : "";
}

/**
 * Options for converting AG-UI messages to Vercel AI SDK format
 */
export interface MessageConversionOptions {
  forwardSystemMessages?: boolean;
  forwardDeveloperMessages?: boolean;
}

/**
 * Converts AG-UI messages to Vercel AI SDK ModelMessage format
 */
export function convertMessagesToVercelAISDKMessages(
  messages: Message[],
  options: MessageConversionOptions = {},
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "system" && options.forwardSystemMessages) {
      const systemMsg: SystemModelMessage = {
        role: "system",
        content: message.content ?? "",
      };
      result.push(systemMsg);
    } else if (
      message.role === "developer" &&
      options.forwardDeveloperMessages
    ) {
      const systemMsg: SystemModelMessage = {
        role: "system",
        content: message.content ?? "",
      };
      result.push(systemMsg);
    } else if (message.role === "assistant") {
      const parts: Array<TextPart | ToolCallPart> = message.content
        ? [{ type: "text", text: message.content }]
        : [];

      for (const toolCall of message.toolCalls ?? []) {
        const toolCallPart: ToolCallPart = {
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: safeParseToolArgs(toolCall.function.arguments),
        };
        parts.push(toolCallPart);
      }

      const assistantMsg: AssistantModelMessage = {
        role: "assistant",
        content: parts,
      };
      result.push(assistantMsg);
    } else if (message.role === "user") {
      const userMsg: UserModelMessage = {
        role: "user",
        content: convertUserMessageContent(message.content),
      };
      result.push(userMsg);
    } else if (message.role === "tool") {
      let toolName = "unknown";
      // Find the tool name from the corresponding tool call
      for (const msg of messages) {
        if (msg.role === "assistant") {
          for (const toolCall of msg.toolCalls ?? []) {
            if (toolCall.id === message.toolCallId) {
              toolName = toolCall.function.name;
              break;
            }
          }
        }
      }

      const toolResultPart: ToolResultPart = {
        type: "tool-result",
        toolCallId: message.toolCallId,
        toolName: toolName,
        output: toolResultOutput(message.content),
      };

      const toolMsg: ToolModelMessage = {
        role: "tool",
        content: [toolResultPart],
      };
      result.push(toolMsg);
    }
  }

  return result;
}
