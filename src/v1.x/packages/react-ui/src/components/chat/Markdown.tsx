import { ComponentProps, FC, memo, useId as reactUseId } from "react";
import { CodeBlock } from "./CodeBlock";

/**
 * BACKWARD COMPATIBILITY: Supporting both React 17 and React 18+
 *
 * Problem: streamdown uses React's useId hook, which was introduced in React 18.
 * This causes "useId is not a function" errors for users on React 17.
 *
 * Solution: Import both renderers and auto-detect React version at runtime.
 * - React 18+: Uses streamdown (modern, optimized for AI streaming)
 * - React 17: Falls back to react-markdown (proven, stable)
 *
 * Modern bundlers will tree-shake the unused renderer, so bundle size
 * impact is minimal for users on either version.
 */
import { Streamdown } from "streamdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";

// Auto-detect React version by checking for React 18+ useId hook
const hasUseId = typeof reactUseId === "function";

type StreamdownOptions = ComponentProps<typeof Streamdown>;
type ReactMarkdownComponents = any; // react-markdown Components type

const defaultComponents: any = {
  a({ children, ...props }: any) {
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

    return (
      <CodeBlock
        key={Math.random()}
        language={(match && match[1]) || ""}
        value={String(children).replace(/\n$/, "")}
        {...props}
      />
    );
  },
  h1: ({ children, ...props }: any) => (
    <h1 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: any) => (
    <h2 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: any) => (
    <h3 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: any) => (
    <h4 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }: any) => (
    <h5 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }: any) => (
    <h6 className="copilotKitMarkdownElement" {...props}>
      {children}
    </h6>
  ),
  p: ({ children, ...props }: any) => (
    <p className="copilotKitMarkdownElement" {...props}>
      {children}
    </p>
  ),
  pre: ({ children, ...props }: any) => (
    <pre className="copilotKitMarkdownElement" {...props}>
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }: any) => (
    <blockquote className="copilotKitMarkdownElement" {...props}>
      {children}
    </blockquote>
  ),
  ul: ({ children, ...props }: any) => (
    <ul className="copilotKitMarkdownElement" {...props}>
      {children}
    </ul>
  ),
  li: ({ children, ...props }: any) => (
    <li className="copilotKitMarkdownElement" {...props}>
      {children}
    </li>
  ),
};

type MarkdownProps = {
  content: string;
  components?: any; // Compatible with both renderers
};

// Memoized ReactMarkdown wrapper for React 17
const MemoizedReactMarkdown: FC<any> = memo(
  ReactMarkdown,
  (prevProps: any, nextProps: any) =>
    prevProps.children === nextProps.children && prevProps.components === nextProps.components,
);

export const Markdown = ({ content, components }: MarkdownProps) => {
  return (
    <div className="copilotKitMarkdown">
      {hasUseId ? (
        // React 18+: Use streamdown for better AI streaming performance
        <Streamdown components={{ ...defaultComponents, ...components }}>
          {content}
        </Streamdown>
      ) : (
        // React 17: Fallback to react-markdown (doesn't require useId hook)
        <MemoizedReactMarkdown
          components={{ ...defaultComponents, ...components }}
          remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
          rehypePlugins={[rehypeRaw]}
        >
          {content}
        </MemoizedReactMarkdown>
      )}
    </div>
  );
};
