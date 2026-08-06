import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { Message } from "@ag-ui/client";

/** Rejects an AG-UI run that cannot become one stable ACP prompt. */
export class AcpPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpPromptError";
  }
}

type AguiUserContent = Extract<Message, { role: "user" }>["content"];

const toAcpContent = (content: AguiUserContent): readonly ContentBlock[] => {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return content.map((part, index): ContentBlock => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    if (part.type === "image" && part.source.type === "data") {
      return {
        type: "image",
        data: part.source.value,
        mimeType: part.source.mimeType,
      };
    }
    if (part.type === "audio" && part.source.type === "data") {
      return {
        type: "audio",
        data: part.source.value,
        mimeType: part.source.mimeType,
      };
    }
    if (
      (part.type === "image" ||
        part.type === "audio" ||
        part.type === "video" ||
        part.type === "document") &&
      part.source.type === "url"
    ) {
      return {
        type: "resource_link",
        name: part.type,
        uri: part.source.value,
        ...(part.source.mimeType ? { mimeType: part.source.mimeType } : {}),
      };
    }
    if (
      (part.type === "document" || part.type === "video") &&
      part.source.type === "data"
    ) {
      return {
        type: "resource",
        resource: {
          blob: part.source.value,
          mimeType: part.source.mimeType,
          uri: `agui://input/${index}/${part.type}`,
        },
      };
    }
    if (part.type === "binary" && part.url) {
      return {
        type: "resource_link",
        name: part.filename ?? part.id ?? "binary",
        uri: part.url,
        mimeType: part.mimeType,
      };
    }
    if (part.type === "binary" && part.data) {
      return {
        type: "resource",
        resource: {
          blob: part.data,
          mimeType: part.mimeType,
          uri: `agui://input/${index}/${encodeURIComponent(
            part.filename ?? part.id ?? "binary",
          )}`,
        },
      };
    }
    throw new AcpPromptError(
      `AG-UI ${part.type} content cannot be represented as an ACP prompt`,
    );
  });
};

/** Converts the final user-authored AG-UI message into one stable ACP prompt. */
export function selectLatestAcpPrompt(
  messages: readonly Message[],
): readonly ContentBlock[] {
  const message = messages.at(-1);
  if (message?.role !== "user") {
    throw new AcpPromptError(
      "An ACP run requires one new user message at the end of AG-UI history",
    );
  }
  return toAcpContent(message.content);
}
