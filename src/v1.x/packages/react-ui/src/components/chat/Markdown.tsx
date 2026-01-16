import { ComponentPropsWithoutRef } from "react";
import { Streamdown } from "streamdown";
import { CodeBlock } from "./CodeBlock";

type Components = ComponentPropsWithoutRef<typeof Streamdown>["components"];

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
  pre({ children, ...props }) {
    // Extract language from the code element's className
    const codeElement = children as React.ReactElement<{
      className?: string;
      children?: React.ReactNode;
    }>;
    const className = codeElement?.props?.className || "";
    const match = /language-(\w+)/.exec(className);
    const language = match ? match[1] : "";

    return (
      <CodeBlock language={language}>
        <pre className="copilotKitMarkdownElement" {...props}>
          {children}
        </pre>
      </CodeBlock>
    );
  },
  code({ children, className, ...props }) {
    // Check if this is inline code (no language class and no newlines)
    const match = /language-(\w+)/.exec(className || "");
    const content = String(children);
    const hasNewlines = content.includes("\n");
    const isInline = !match && !hasNewlines;

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
      <code className={`copilotKitMarkdownElement ${className || ""}`} {...props}>
        {children}
      </code>
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

type MarkdownProps = {
  content: string;
  components?: Components;
};

export const Markdown = ({ content, components }: MarkdownProps) => {
  return (
    <div className="copilotKitMarkdown">
      <Streamdown components={{ ...defaultComponents, ...components }}>
        {content}
      </Streamdown>
    </div>
  );
};
