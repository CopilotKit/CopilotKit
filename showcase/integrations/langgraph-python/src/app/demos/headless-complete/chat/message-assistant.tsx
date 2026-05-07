"use client";

/**
 * Assistant message bubble. Left-aligned bot avatar, muted bubble with
 * markdown text, plus a column of tool-call cards rendered through
 * `useRenderToolCall` (passed in as `children`).
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function AssistantBubble({
  content,
  children,
}: {
  content?: string;
  children?: React.ReactNode;
}) {
  const hasText = typeof content === "string" && content.trim().length > 0;
  const hasChildren = React.Children.count(children) > 0;
  if (!hasText && !hasChildren) return null;

  return (
    <div
      data-testid="headless-message-assistant"
      className="flex w-full items-start gap-3"
    >
      <Avatar className="h-8 w-8 shrink-0 border bg-muted text-muted-foreground">
        <AvatarFallback className="bg-muted text-muted-foreground">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>

      <div className="flex max-w-[calc(100%-2.75rem)] flex-1 flex-col items-start gap-2">
        {hasText && (
          <div
            className={cn(
              "max-w-[90%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed shadow-sm",
              "bg-muted text-foreground",
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => (
                  <p className="my-1 first:mt-0 last:mb-0">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="my-1 list-disc pl-5">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-1 list-decimal pl-5">{children}</ol>
                ),
                li: ({ children }) => <li className="my-0.5">{children}</li>,
                code: ({ children, className }) => {
                  const isBlock = (className ?? "").includes("language-");
                  if (isBlock) {
                    return <code className={className}>{children}</code>;
                  }
                  return (
                    <code className="rounded bg-background px-1 py-0.5 font-mono text-[0.85em]">
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="my-2 overflow-x-auto rounded-md bg-background p-3 font-mono text-xs">
                    {children}
                  </pre>
                ),
                a: ({ children, href }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold">{children}</strong>
                ),
                h1: ({ children }) => (
                  <h1 className="my-2 text-base font-semibold">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="my-2 text-base font-semibold">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="my-2 text-sm font-semibold">{children}</h3>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
                    {children}
                  </blockquote>
                ),
              }}
            >
              {content as string}
            </ReactMarkdown>
          </div>
        )}
        {hasChildren && (
          <div className="flex w-full max-w-full flex-col gap-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
