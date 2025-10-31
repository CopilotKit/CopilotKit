import { FC, memo } from "react";
import ReactMarkdown, { Options, Components } from "react-markdown";
import { CodeBlock } from "./CodeBlock";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";

// Simple hash function to generate stable keys for code blocks
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

const defaultComponents: Components = {
  a({ children, ...props }) {
    return (
      <a className="copilotKitMarkdownElement" {...props} target="_blank" rel="noopener noreferrer">
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

    // Detect inline code: if it has a language class or contains newlines, it's likely a code block
    // Otherwise, treat it as inline code
    const hasLanguage = match && match[1];
    const content = String(children);
    const hasNewlines = content.includes("\n");
    const isInline = !hasLanguage && !hasNewlines;

    if (isInline) {
      return (
        <code
          className={`copilotKitMarkdownElement copilotKitInlineCode ${className || ""}`}
          {...props}
        >
          {children}
        </code>
      );
    }

    const codeValue = String(children).replace(/\n$/, "");
    const language = (match && match[1]) || "";
    // Generate a stable key from the language and content to prevent flickering
    const stableKey = `${language}-${hashCode(codeValue)}`;

    return (
      <CodeBlock
        key={stableKey}
        language={language}
        value={codeValue}
        {...props}
      />
    );
  },
  h1: ({ children, ...props }) => (
    <h1 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h6>
  ),
  p: ({ children, ...props }) => (
    <p className="copilotKitMarkdownElement" {...props}>
      {children}
    </p>
  ),
  pre: ({ children, ...props }) => (
    <pre className="copilotKitMarkdownElement" {...props}>
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="copilotKitMarkdownElement" {...props}>
      {children}
    </blockquote>
  ),
  ul: ({ children, ...props }) => (
    <ul className="copilotKitMarkdownElement" {...props}>
      {children}
    </ul>
  ),
  li: ({ children, ...props }) => (
    <li className="copilotKitMarkdownElement" {...props}>
      {children}
    </li>
  ),
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
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeRaw]}
      >
        {content}
      </MemoizedReactMarkdown>
    </div>
  );
};
