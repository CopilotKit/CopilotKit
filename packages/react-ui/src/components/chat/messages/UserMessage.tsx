/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — UserMessage:
 *   V2 import and usage:
 *     import { UserMessage } from "@copilotkit/react-core/v2";
 *     const v2UserMessage = UserMessage;
 *   V2 replacement source: packages/react-core/src/v2/index.ts
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-ui/src/components/chat/messages/UserMessage.tsx
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { UserMessageProps } from "../props";
import { AttachmentRenderer } from "../AttachmentRenderer";

type UserMessageContent = NonNullable<UserMessageProps["message"]>["content"];

const getTextContent = (
  content: UserMessageContent | undefined,
): string | undefined => {
  if (typeof content === "undefined") {
    return undefined;
  }

  if (typeof content === "string") {
    return content;
  }

  return (
    content
      .map((part) => {
        if (part.type === "text") {
          return part.text;
        }
        return undefined;
      })
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
      .join(" ")
      .trim() || undefined
  );
};

const getMediaParts = (content: UserMessageContent | undefined) => {
  if (!content || typeof content === "string") return [];

  return content.filter(
    (part) =>
      part.type === "image" ||
      part.type === "audio" ||
      part.type === "video" ||
      part.type === "document",
  ) as Array<{
    type: "image" | "audio" | "video" | "document";
    source:
      | { type: "data"; value: string; mimeType: string }
      | { type: "url"; value: string; mimeType?: string };
  }>;
};

export const UserMessage = (props: UserMessageProps) => {
  const { message, ImageRenderer } = props;
  const content = message?.content;

  // Legacy path: old-style image field on message
  const isLegacyImageMessage =
    message && "image" in message && Boolean((message as any).image);

  if (isLegacyImageMessage) {
    const legacyImage = (message as any).image;
    const textContent = getTextContent(content);
    return (
      <div className="copilotKitMessage copilotKitUserMessage">
        <ImageRenderer image={legacyImage} content={textContent} />
      </div>
    );
  }

  const textContent = getTextContent(content);
  const mediaParts = getMediaParts(content);

  if (mediaParts.length === 0) {
    return (
      <div className="copilotKitMessage copilotKitUserMessage">
        {textContent}
      </div>
    );
  }

  return (
    <div className="copilotKitMessage copilotKitUserMessage">
      {textContent && <div>{textContent}</div>}
      {mediaParts.map((part, index) => (
        <AttachmentRenderer key={index} type={part.type} source={part.source} />
      ))}
    </div>
  );
};
