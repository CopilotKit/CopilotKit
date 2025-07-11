import { UserMessageProps } from "../props";

export const UserMessage = (props: UserMessageProps) => {
  const { message, ImageRenderer } = props;
  const isImageMessage = message && "image" in message && message.image;

  // Image message
  if (isImageMessage) {
    const imageMessage = message;

    return (
      <div className="copilotKitMessage copilotKitUserMessage">
        <ImageRenderer image={imageMessage.image!} content={imageMessage.content} />
      </div>
    );
  }

  // Regular text message
  return <div className="copilotKitMessage copilotKitUserMessage">{message?.content}</div>;
};
