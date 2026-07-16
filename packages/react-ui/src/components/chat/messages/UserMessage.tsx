import type { UserMessageProps } from "../props";
import { AttachmentRenderer } from "../AttachmentRenderer";
import { useMessageTimestamp } from "../message-timestamps";

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
  const { message, ImageRenderer, showTimestamp, formatTimestamp } = props;
  const content = message?.content;
  const { timestamp, timestampText } = useMessageTimestamp(
    message,
    showTimestamp,
    formatTimestamp,
  );
  const timestampElement =
    timestamp && timestampText ? (
      <time
        className="copilotKitMessageTimestamp"
        data-testid="copilot-message-timestamp"
        dateTime={timestamp.toISOString()}
      >
        {timestampText}
      </time>
    ) : null;

  // Legacy path: old-style image field on message
  const isLegacyImageMessage =
    message && "image" in message && Boolean((message as any).image);

  if (isLegacyImageMessage) {
    const legacyImage = (message as any).image;
    const textContent = getTextContent(content);
    return (
      <div className="copilotKitMessage copilotKitUserMessage">
        <ImageRenderer image={legacyImage} content={textContent} />
        {timestampElement}
      </div>
    );
  }

  const textContent = getTextContent(content);
  const mediaParts = getMediaParts(content);

  if (mediaParts.length === 0) {
    return (
      <div className="copilotKitMessage copilotKitUserMessage">
        {textContent}
        {timestampElement}
      </div>
    );
  }

  return (
    <div className="copilotKitMessage copilotKitUserMessage">
      {textContent && <div>{textContent}</div>}
      {mediaParts.map((part, index) => (
        <AttachmentRenderer key={index} type={part.type} source={part.source} />
      ))}
      {timestampElement}
    </div>
  );
};
