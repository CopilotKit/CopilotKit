"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Integration } from "@/lib/registry";

interface DemoFile {
  filename: string;
  language: string;
  content: string;
}

interface DemoContent {
  readme: string | null;
  files: DemoFile[];
  backend_files?: DemoFile[];
}

function parseLineRange(spec: string | null): Set<number> {
  const highlighted = new Set<number>();
  if (!spec) return highlighted;
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [a, b] = trimmed.split("-").map((n) => parseInt(n, 10));
    if (Number.isNaN(a)) continue;
    const end = Number.isNaN(b) ? a : b;
    for (let i = a; i <= end; i++) highlighted.add(i);
  }
  return highlighted;
}

export default function StandaloneCodePage() {
  const params = useParams<{ slug: string; demo: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [content, setContent] = useState<DemoContent | null>(null);

  useEffect(() => {
    import("@/data/registry.json").then((mod) => {
      const registry = mod.default as { integrations: Integration[] };
      const integ = registry.integrations.find((i) => i.slug === params.slug);
      if (integ) setIntegration(integ);
    });

    import("@/data/demo-content.json").then((mod) => {
      const data = mod.default as { demos: Record<string, DemoContent> };
      const key = `${params.slug}::${params.demo}`;
      setContent(data.demos[key] ?? null);
    });
  }, [params.slug, params.demo]);

  const allFiles: DemoFile[] = useMemo(() => {
    if (!content) return [];
    return [...content.files, ...(content.backend_files ?? [])];
  }, [content]);

  const activeFilename = searchParams.get("file") ?? allFiles[0]?.filename;
  const activeFile =
    allFiles.find((f) => f.filename === activeFilename) ?? allFiles[0];

  const highlightedLines = useMemo(
    () => parseLineRange(searchParams.get("lines")),
    [searchParams],
  );

  if (!integration) {
    return (
      <div className="flex h-[calc(100vh-52px)] items-center justify-center text-[var(--text-muted)]">
        Loading code…
      </div>
    );
  }

  if (!content || allFiles.length === 0) {
    return (
      <div className="flex h-[calc(100vh-52px)] items-center justify-center text-[var(--text-muted)]">
        No source files bundled for this demo.
      </div>
    );
  }

  const selectFile = (filename: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("file", filename);
    next.delete("lines");
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="flex h-[calc(100vh-52px)]">
      <div className="flex h-full w-48 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="p-3 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Files
        </div>
        {allFiles.map((file) => (
          <button
            key={file.filename}
            onClick={() => selectFile(file.filename)}
            className={`px-4 py-2 text-left text-xs font-mono transition-colors ${
              activeFile?.filename === file.filename
                ? "bg-[var(--bg-elevated)] text-[var(--text)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/50"
            }`}
          >
            {file.filename}
          </button>
        ))}
        <div className="mt-auto border-t border-[var(--border)] p-3">
          <a
            href={integration.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[var(--accent)] hover:underline"
          >
            View on GitHub
          </a>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {activeFile && (
          <SyntaxHighlighter
            language={activeFile.language}
            style={oneLight}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              background: "var(--bg)",
              fontSize: "13px",
              lineHeight: "1.6",
            }}
            showLineNumbers
            wrapLines={highlightedLines.size > 0}
            lineNumberStyle={{
              color: "var(--text-muted)",
              fontSize: "11px",
              paddingRight: "1em",
              minWidth: "3em",
            }}
            lineProps={(lineNumber) =>
              highlightedLines.has(lineNumber)
                ? {
                    style: {
                      display: "block",
                      background: "rgba(250, 204, 21, 0.18)",
                    },
                  }
                : {}
            }
          >
            {activeFile.content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
