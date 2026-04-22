"use client";

import { useEffect, useRef } from "react";
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

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.removeAttribute("data-highlighted");
      hljs.highlightElement(codeRef.current);
    }
  }, [code, language]);

  const lines = code.split("\n");
  const pad = String(lines.length).length;

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        overflow: "auto",
        background: "#ffffff",
      }}
    >
      {/* Line numbers */}
      <div
        style={{
          padding: "16px 0 16px 16px",
          textAlign: "right",
          userSelect: "none",
          color: "#838389",
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily:
            "'Spline Sans Mono', 'SF Mono', Menlo, Consolas, monospace",
          whiteSpace: "pre",
          flexShrink: 0,
        }}
      >
        {lines.map((_, i) => (
          <div key={i}>{String(i + 1).padStart(pad, " ")}</div>
        ))}
      </div>
      {/* Code */}
      <pre
        style={{
          margin: 0,
          padding: "16px",
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily:
            "'Spline Sans Mono', 'SF Mono', Menlo, Consolas, monospace",
          whiteSpace: "pre",
          overflowX: "auto",
          flex: 1,
        }}
      >
        <code ref={codeRef} className={`language-${language}`}>
          {code}
        </code>
      </pre>
    </div>
  );
}
