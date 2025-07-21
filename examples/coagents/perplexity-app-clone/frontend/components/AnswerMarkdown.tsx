import Markdown from "react-markdown";

export function AnswerMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-wrapper">
      <Markdown>{markdown}</Markdown>
    </div>
  );
}
