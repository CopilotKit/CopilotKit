/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — Markdown:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { FC } from "react";
import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useId,
  useMemo,
} from "react";
import type { Options, Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import {
  A2UIMarkdownSurface,
  useA2UIMarkdownConfig,
} from "@copilotkit/react-core/v2";
import { CodeBlock } from "./CodeBlock";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

function isA2UICodeElement(children: unknown): boolean {
  const child = Array.isArray(children) ? children[0] : children;
  return (
    isValidElement<{ className?: string }>(child) &&
    /(^|\s)language-a2ui(\s|$)/.test(child.props.className ?? "")
  );
}

/**
 * Whether the message being rendered is still streaming. react-markdown's
 * component overrides are static, so the flag reaches the code renderer
 * through context rather than props.
 */
const MarkdownStreamingContext = createContext(false);

/**
 * v1 renders each ```a2ui fence as its own surface: unlike the v2
 * A2UIMarkdownRenderer, fences that reuse an earlier fence's surfaceId are not
 * merged into that surface.
 */
const A2UIFence: FC<{ value: string; closed: boolean }> = ({
  value,
  closed,
}) => {
  const config = useA2UIMarkdownConfig();
  const fallbackId = useId();
  if (!config) return <CodeBlock language="a2ui" value={value} />;
  return (
    <A2UIMarkdownSurface
      fenceText={value}
      closed={closed}
      fallbackSurfaceId={`v1-${fallbackId}`}
    />
  );
};

/**
 * An ```a2ui code block. The fence counts as closed only once the message has
 * stopped streaming and no streaming cursor ("▍") trails it; react-markdown
 * cannot tell an unterminated fence from a terminated one. While a message
 * streams, every fence in it stays open (no failure card, skeleton until the
 * root component arrives).
 */
const A2UICodeBlock: FC<{ raw: string }> = ({ raw }) => {
  const isStreaming = useContext(MarkdownStreamingContext);
  const cursor = /▍\s*$/.test(raw);
  return (
    <A2UIFence
      value={raw.replace(/▍\s*$/, "").replace(/\n$/, "") + "\n"}
      closed={!isStreaming && !cursor}
    />
  );
};

const defaultComponents: Components = {
  a({ children, ...props }) {
    return (
      <a
        className="copilotKitMarkdownElement"
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

    if (match && match[1] === "a2ui") {
      return <A2UICodeBlock raw={String(children)} />;
    }

    return (
      <CodeBlock
        language={(match && match[1]) || ""}
        value={String(children).replace(/\n$/, "")}
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
    <div className="copilotKitMarkdownElement copilotKitParagraph" {...props}>
      {children}
    </div>
  ),
  pre({ children, ...props }) {
    // An ```a2ui fence renders a live surface, not preformatted text, so it
    // must not sit inside a <pre> (monospace font, preserved whitespace).
    if (isA2UICodeElement(children)) return <>{children}</>;
    return (
      <pre className="copilotKitMarkdownElement" {...props}>
        {children}
      </pre>
    );
  },
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

const MemoizedReactMarkdown: FC<Options> = memo(ReactMarkdown);

type MarkdownProps = Omit<Options, "children"> & {
  content: string;
  /**
   * Whether the content is still streaming. ```a2ui fences stay open (no
   * failure card) until it is false.
   */
  isStreaming?: boolean;
};

export const Markdown = ({
  content,
  isStreaming = false,
  components,
  remarkPlugins,
  rehypePlugins,
  ...rest
}: MarkdownProps) => {
  const mergedComponents = useMemo(
    () => ({ ...defaultComponents, ...components }),
    [components],
  );
  const mergedRemarkPlugins = useMemo<Options["remarkPlugins"]>(
    () => [
      remarkGfm,
      [remarkMath, { singleDollarTextMath: false }],
      ...(remarkPlugins ?? []),
    ],
    [remarkPlugins],
  );
  const mergedRehypePlugins = useMemo<Options["rehypePlugins"]>(
    () => [rehypeRaw, ...(rehypePlugins ?? []), rehypeSanitize],
    [rehypePlugins],
  );
  return (
    <div className="copilotKitMarkdown">
      <MarkdownStreamingContext.Provider value={isStreaming}>
        <MemoizedReactMarkdown
          {...rest}
          components={mergedComponents}
          remarkPlugins={mergedRemarkPlugins}
          rehypePlugins={mergedRehypePlugins}
        >
          {content}
        </MemoizedReactMarkdown>
      </MarkdownStreamingContext.Provider>
    </div>
  );
};
