import React from "react";
import { FC, memo } from "react";
import ReactMarkdown, { Options, Components } from "react-markdown";
import { CodeBlock } from "./CodeBlock";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const MemoizedReactMarkdown: FC<Options> = memo(
  ReactMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && prevProps.className === nextProps.className,
);

type MarkdownProps = {
  content: string;
};

export const Markdown: React.FC<MarkdownProps> = ({ content }) => {
  return (
    <div className="copilotKitMarkdown">
      <MemoizedReactMarkdown
        className="prose break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0"
        components={components}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {content}
      </MemoizedReactMarkdown>
    </div>
  );
};

const components: Components = {
  p({ children }) {
    return <p>{children}</p>;
  },
  code({ children, className, inline, ...props }) {
    if (children.length) {
      if (children[0] == "▍") {
        return <span className="mt-1 animate-pulse cursor-default">▍</span>;
      }

      children[0] = (children[0] as string).replace("`▍`", "▍");
    }

    const match = /language-(\w+)/.exec(className || "");

    if (inline) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    return (
      <CodeBlock
        key={Math.random()}
        language={(match && match[1]) || ""}
        value={String(children).replace(/\n$/, "")}
        {...props}
      />
    );
  },
};
