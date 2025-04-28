import { FC, memo } from "react";
import ReactMarkdown, { Options, Components } from "react-markdown";
import { CodeBlock } from "./CodeBlock";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";

const defaultComponents: Components = {
  a({ children, ...props }) {
    return (
      <a
        style={{ color: "blue", textDecoration: "underline" }}
        {...props}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  // @ts-expect-error -- inline
  code({ children, className, inline, ...props }) {
    if (Array.isArray(children) && children.length) {
      if (children[0] == "▍") {
        return (
          <span
            style={{
              animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
              marginTop: "0.25rem",
            }}
          >
            ▍
          </span>
        );
      }

      children[0] = (children?.[0] as string).replace("`▍`", "▍");
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

const MemoizedReactMarkdown: FC<Options> = memo(
  ReactMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && prevProps.components === nextProps.components,
);

type MarkdownProps = {
  content: string;
  components?: Components;
};

export const Markdown = ({ content, components }: MarkdownProps) => {
  return (
    <div className="copilotKitMarkdown">
      <MemoizedReactMarkdown
        components={{ ...defaultComponents, ...components }}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw]}
      >
        {content}
      </MemoizedReactMarkdown>
    </div>
  );
};
