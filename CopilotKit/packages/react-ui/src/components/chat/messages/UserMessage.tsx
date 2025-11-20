import { UserMessageProps } from "../props";

type UserMessageContent = NonNullable<UserMessageProps["message"]>["content"];

const getTextContent = (content: UserMessageContent | undefined): string | undefined => {
  if (typeof content === "undefined") {
    return undefined;
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      return undefined;
    })
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .trim() || undefined;
};

export const UserMessage = (props: UserMessageProps) => {
  const { message, ImageRenderer } = props;
  const isImageMessage = message && "image" in message && Boolean(message.image);

  if (isImageMessage) {
    const imageMessage = message!;
    const content = getTextContent(imageMessage?.content);

    return (
      <div className="copilotKitMessage copilotKitUserMessage">
        <ImageRenderer image={imageMessage.image!} content={content} />
      </div>
    );
  }

  const content = getTextContent(message?.content);

  return <div className="copilotKitMessage copilotKitUserMessage">{content}</div>;
};
