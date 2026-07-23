"use client";

import { ShikiHighlighter } from "react-shiki";

interface CodeBlockProps {
  code: string;
  language: string;
  maxHeight?: number;
  className?: string;
}

/**
 * Lightweight wrapper around react-shiki's <ShikiHighlighter> with the cockpit's
 * styling defaults. Used by ShellOutputCard, FileReadCard, and DiffProposalCard
 * to render syntax-highlighted code instead of raw <pre> blocks.
 */
export function CodeBlock({
  code,
  language,
  maxHeight = 240,
  className = "",
}: CodeBlockProps) {
  return (
    <div
      className={`overflow-auto rounded border border-[var(--cr-rule)] bg-[var(--cr-surface-3)] text-[11.5px] leading-snug ${className}`}
      style={{ maxHeight, fontFamily: "var(--cr-font-mono)" }}
    >
      <ShikiHighlighter
        language={language}
        theme="github-dark"
        showLanguage={false}
        addDefaultStyles={false}
        className="bg-transparent p-0 [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-3 [&_code]:!bg-transparent [&_pre]:whitespace-pre-wrap"
      >
        {code}
      </ShikiHighlighter>
    </div>
  );
}

/**
 * Guess a Shiki-supported language id from a file path. Falls back to "text"
 * which renders without highlighting.
 */
export function languageFromPath(path: string | undefined): string {
  if (!path) return "text";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "css":
      return "css";
    case "html":
      return "html";
    case "sh":
    case "bash":
      return "bash";
    case "cs":
      return "csharp";
    case "py":
      return "python";
    default:
      return "text";
  }
}
