import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import JSON5 from "json5";
import type { CSSProperties } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import Image from "next/image";

// Fixed SyntaxHighlighter component to handle type issues
const CodeHighlighter: React.FC<{
  language: string;
  children: string;
  customStyle?: CSSProperties;
}> = ({ language, children, customStyle }) => {
  return (
    <SyntaxHighlighter
      style={vscDarkPlus}
      language={language}
      customStyle={customStyle}
      wrapLines={true}
      wrapLongLines={true}
      showLineNumbers={true}
    >
      {children}
    </SyntaxHighlighter>
  );
};

// Utilities to check and format content
const isJsonString = (str: string) => {
  try {
    JSON5.parse(str);
    return true;
  } catch {
    return false;
  }
};

const formatContent = (content: string) => {
  if (isJsonString(content)) {
    try {
      return JSON.stringify(JSON5.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
};

// Helper function to check if content contains search results
const isSearchResults = (content: string) => {
  try {
    const data = JSON5.parse(content);
    return (
      data.searchParameters &&
      data.searchParameters.q &&
      data.organic &&
      Array.isArray(data.organic)
    );
  } catch {
    return false;
  }
};

interface FormattedContentProps {
  content: string;
  showJsonLabel?: boolean; // Controls whether to show the JSON label
  isCollapsed?: boolean; // Controls whether content is collapsed by default
}

export { isJsonString, formatContent, isSearchResults };

const FormattedContent: React.FC<FormattedContentProps> = ({
  content,
  showJsonLabel = true,
  isCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState(isCollapsed);

  // Preview for collapsed state
  const getPreview = (content: string): string => {
    const trimmedContent = content.trim();
    return trimmedContent.length > 50
      ? trimmedContent.substring(0, 50) + "..."
      : trimmedContent;
  };

  const toggleCollapse = () => {
    setCollapsed(!collapsed);
  };

  // Collapsible wrapper component
  const CollapsibleContent: React.FC<{ children: React.ReactNode }> = ({
    children,
  }) => {
    return (
      <div>
        <div
          className="flex items-center cursor-pointer text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 mb-1"
          onClick={toggleCollapse}
        >
          {collapsed ? (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              <span>Expand {isJsonString(content) ? "JSON" : "content"}</span>
              <span className="ml-2 opacity-60">{getPreview(content)}</span>
            </>
          ) : (
            <>
              <ChevronUp className="h-3 w-3 mr-1" />
              <span>Collapse {isJsonString(content) ? "JSON" : "content"}</span>
            </>
          )}
        </div>
        {!collapsed && children}
      </div>
    );
  };

  if (isJsonString(content)) {
    // If it's JSON, format and display with syntax highlighting
    return (
      <>
        {showJsonLabel && isJsonString(content) && !collapsed && (
          <span className="ml-2 text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full">
            JSON
          </span>
        )}
        <CollapsibleContent>
          <div
            className="bg-gray-800 rounded-md overflow-y-auto"
            style={{ wordBreak: "break-word" }}
          >
            <CodeHighlighter
              language="json"
              customStyle={{
                margin: 0,
                fontSize: "0.75rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "break-word",
              }}
            >
              {formatContent(content)}
            </CodeHighlighter>
          </div>
        </CollapsibleContent>
      </>
    );
  }

  // If it's not JSON, render as Markdown
  return (
    <CollapsibleContent>
      <div className="markdown-content bg-gray-50 dark:bg-zinc-700/40 p-3 rounded-md border border-gray-200 dark:border-zinc-700">
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
          <ReactMarkdown
            components={{
              code({
                className,
                children,
                ...props
              }: React.ComponentPropsWithoutRef<"code"> & {
                className?: string;
              }) {
                const match = /language-(\w+)/.exec(className || "");
                return match ? (
                  <CodeHighlighter
                    language={match[1]}
                    customStyle={{
                      margin: "0.5rem 0",
                      borderRadius: "0.25rem",
                      fontSize: "0.75rem",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      overflowWrap: "break-word",
                    }}
                  >
                    {String(children).replace(/\n$/, "")}
                  </CodeHighlighter>
                ) : (
                  <code
                    className={`${className} px-1 py-0.5 bg-gray-200 dark:bg-zinc-700 rounded text-xs`}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              a: ({ ...props }) => (
                <a
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  {...props}
                />
              ),
              table: ({ ...props }) => (
                <div className="overflow-x-auto">
                  <table
                    className="min-w-full border-collapse text-xs"
                    {...props}
                  />
                </div>
              ),
              th: ({ ...props }) => (
                <th
                  className="border border-gray-300 dark:border-zinc-600 p-1 bg-gray-100 dark:bg-zinc-700"
                  {...props}
                />
              ),
              td: ({ ...props }) => (
                <td
                  className="border border-gray-300 dark:border-zinc-600 p-1"
                  {...props}
                />
              ),
              pre: ({ ...props }) => (
                <pre
                  className="overflow-auto rounded bg-gray-800 dark:bg-zinc-800 p-2 text-xs"
                  {...props}
                />
              ),
              img: ({ src, alt }) => {
                if (!src) {
                  return null;
                }
                return (
                  <Image
                    src={src}
                    alt={alt || ""}
                    width={800}
                    height={600}
                    className="max-w-full h-auto rounded"
                    style={{ objectFit: "contain" }}
                  />
                );
              },
              blockquote: ({ ...props }) => (
                <blockquote
                  className="border-l-4 border-gray-300 dark:border-zinc-600 pl-3 italic text-gray-600 dark:text-gray-300"
                  {...props}
                />
              ),
              ul: ({ ...props }) => (
                <ul className="list-disc pl-5 space-y-1" {...props} />
              ),
              ol: ({ ...props }) => (
                <ol className="list-decimal pl-5 space-y-1" {...props} />
              ),
              p: ({ ...props }) => (
                <p
                  className="text-gray-700 dark:text-gray-300 break-words"
                  {...props}
                />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </CollapsibleContent>
  );
};

export default FormattedContent;
