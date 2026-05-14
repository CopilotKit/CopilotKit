"use client";

import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import csharp from "highlight.js/lib/languages/csharp";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("markdown", markdown);

const LANGUAGES_SUPPORTED = new Set([
  "typescript",
  "javascript",
  "python",
  "csharp",
  "json",
  "yaml",
  "css",
  "markdown",
]);

interface CodeBlockProps {
  code: string;
  language: string;
  /**
   * 1-based line numbers that should render with a region-highlight
   * background. Empty / undefined means no highlighting.
   */
  highlightedLines?: ReadonlySet<number>;
}

export function CodeBlock({
  code,
  language,
  highlightedLines,
}: CodeBlockProps) {
  // Highlight the whole file once, then split into per-line HTML strings.
  // Splitting after highlighting means single-line constructs render with
  // correct token classes; multi-line block comments / template literals
  // can lose their wrapping span at the line break, but that's a minor
  // cosmetic glitch in exchange for cheap per-line backgrounds.
  const lineHtml = useMemo(() => {
    const lang = language?.toLowerCase();
    const raw = code.endsWith("\n") ? code.slice(0, -1) : code;
    if (!lang || !LANGUAGES_SUPPORTED.has(lang)) {
      return raw.split("\n").map(escapeHtml);
    }
    try {
      return hljs.highlight(raw, { language: lang }).value.split("\n");
    } catch {
      return raw.split("\n").map(escapeHtml);
    }
  }, [code, language]);

  const pad = String(lineHtml.length).length;

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        overflow: "auto",
        background: "#ffffff",
        fontFamily: "'Spline Sans Mono', 'SF Mono', Menlo, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: "inline-block",
          minWidth: "100%",
          padding: "16px 0",
        }}
      >
        {lineHtml.map((html, i) => {
          const lineNum = i + 1;
          const isHighlighted = highlightedLines?.has(lineNum) ?? false;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                background: isHighlighted
                  ? "rgba(250, 204, 21, 0.22)"
                  : "transparent",
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  textAlign: "right",
                  userSelect: "none",
                  color: "#838389",
                  padding: "0 12px 0 16px",
                  whiteSpace: "pre",
                }}
              >
                {String(lineNum).padStart(pad, " ")}
              </div>
              <div
                style={{
                  flex: 1,
                  whiteSpace: "pre",
                  paddingRight: 16,
                }}
                // hljs returns sanitized HTML and the highlighted source is
                // not user input — this content is bundled at build time
                // from files in `showcase/integrations/`.
                dangerouslySetInnerHTML={{ __html: html || " " }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
