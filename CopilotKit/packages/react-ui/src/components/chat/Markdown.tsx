import { Streamdown } from "streamdown";

type MarkdownProps = {
  content: string;
};

export const Markdown = ({ content }: MarkdownProps) => {
  return (
    <div className="copilotKitMarkdown">
      <Streamdown>{content}</Streamdown>
    </div>
  );
};
