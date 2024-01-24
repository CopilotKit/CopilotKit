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

export const Markdown = ({ content }: MarkdownProps) => {
  return (
    <MemoizedReactMarkdown
      className="prose break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 text-sm"
      components={components}
      remarkPlugins={[remarkGfm, remarkMath]}
    >
      {content}
    </MemoizedReactMarkdown>
  );
};

const components: Components = {
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
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
