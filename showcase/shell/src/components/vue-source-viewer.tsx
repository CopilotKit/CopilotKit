"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import sourceContentData from "@/data/vue-source-content.json";

const sourceContent = sourceContentData as {
  files: Record<string, { language: string; content: string }>;
  defaultFileByFeature: Record<string, string>;
};

/** Show the real canonical Vue source selected for the runnable feature. */
export function VueSourceViewer({ feature }: { feature: string }) {
  const filename = sourceContent.defaultFileByFeature[feature];
  const source = filename ? sourceContent.files[filename] : undefined;
  if (!filename || !source) {
    throw new Error(
      `Missing Vue source for feature ${JSON.stringify(feature)}`,
    );
  }

  return (
    <div className="flex h-[calc(100vh-52px)]">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
        <h1 className="px-4 pb-2 pt-4 text-sm font-semibold text-[var(--text)]">
          Vue source
        </h1>
        <p className="px-4 pb-3 font-mono text-xs text-[var(--text-muted)]">
          {feature}
        </p>
        <p className="px-4 font-mono text-xs text-[var(--text)]">{filename}</p>
        <p className="mt-auto border-t border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
          One source tree builds every Vue integration demo.
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
