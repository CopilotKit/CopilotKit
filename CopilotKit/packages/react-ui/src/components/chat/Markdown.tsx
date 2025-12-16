import { ComponentPropsWithoutRef } from "react";
import { Streamdown } from "streamdown";

type MarkdownProps = {
  content: string;
  components?: ComponentPropsWithoutRef<typeof Streamdown>['components'];
};

export const Markdown = ({ content, components }: MarkdownProps) => {
  return (
    <div className="copilotKitMarkdown">
      <Streamdown components={components}>{content}</Streamdown>
    </div>
  );
};
