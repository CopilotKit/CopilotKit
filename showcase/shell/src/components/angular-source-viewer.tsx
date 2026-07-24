"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import sourceContentData from "@/data/angular-source-content.json";

interface SourceFile {
  language: string;
  content: string;
}

const sourceContent = sourceContentData as {
  files: Record<string, SourceFile>;
  defaultFileByFeature: Record<string, string>;
};

/** Show the real canonical Angular source with the feature file selected. */
export function AngularSourceViewer({ feature }: { feature: string }) {
  const filenames = Object.keys(sourceContent.files).sort();
  const defaultFilename =
    sourceContent.defaultFileByFeature[feature] ?? filenames[0];
  const [filename, setFilename] = useState(defaultFilename);
  const source = sourceContent.files[filename];

  return (
    <div className="flex h-[calc(100vh-52px)]">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
        <h1 className="px-4 pb-2 pt-4 text-sm font-semibold text-[var(--text)]">
          Angular source
        </h1>
        <p className="px-4 pb-3 font-mono text-xs text-[var(--text-muted)]">
          {feature}
        </p>
        <label htmlFor="angular-source-file" className="sr-only">
          Source file
        </label>
        <select
          id="angular-source-file"
          value={filename}
          onChange={(event) => setFilename(event.target.value)}
          className="mx-3 mb-3 min-h-10 border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)]"
        >
          {filenames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <p className="mt-auto border-t border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
          One source tree builds every Angular integration demo.
        </p>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto" aria-label={filename}>
        <SyntaxHighlighter
          language={source.language}
          style={oneLight}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            minHeight: "100%",
            background: "var(--bg)",
            fontSize: "13px",
            lineHeight: "1.6",
          }}
          codeTagProps={{ style: { background: "transparent" } }}
          showLineNumbers
        >
          {source.content}
        </SyntaxHighlighter>
      </main>
    </div>
  );
}
