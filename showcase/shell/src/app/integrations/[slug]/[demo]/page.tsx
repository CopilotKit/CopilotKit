"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Demo, Integration } from "@/lib/registry";

type Tab = "preview" | "code" | "docs";

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

export default function DemoViewerPage() {
  const params = useParams<{ slug: string; demo: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("preview");
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [demoContent, setDemoContent] = useState<DemoContent | null>(null);
  const [activeFile, setActiveFile] = useState<number>(0);

  useEffect(() => {
    import("@/data/registry.json").then((mod) => {
      const registry = mod.default as { integrations: Integration[] };
      const integ = registry.integrations.find((i) => i.slug === params.slug);
      if (integ) {
        setIntegration(integ);
        setDemo(integ.demos.find((d) => d.id === params.demo) ?? null);
      }
    });

    import("@/data/demo-content.json").then((mod) => {
      const content = mod.default as {
        demos: Record<string, DemoContent | undefined>;
      };
      const key = `${params.slug}::${params.demo}`;
      const entry = content.demos[key];
      if (entry) {
        setDemoContent(entry);
      }
    });
  }, [params.slug, params.demo]);

  if (!integration || !demo) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center text-[var(--text-muted)]">
        Loading...
      </div>
    );
  }

  // Command-only demos (e.g. `langgraph-python::cli-start`) have no
  // `route`, so there's no iframe URL to build. Surface that explicitly
  // rather than rendering `${backend_url}undefined`.
  const iframeSrc = demo.route
    ? `${integration.backend_url}${demo.route}`
    : null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "preview", label: "Preview" },
    { id: "code", label: "Code" },
    { id: "docs", label: "Docs" },
  ];

  return (
    <div className="flex h-[calc(100vh-52px)] flex-col p-4 gap-3">
      {/* Header bar */}
      <div className="flex items-center justify-between border border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3 rounded-xl">
        <div className="flex items-center gap-3">
          <Link
            href={`/integrations/${integration.slug}`}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            ← {integration.name}
          </Link>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="text-sm font-medium text-[var(--text)]">
            {demo.name}
          </span>
        </div>
        <div className="flex gap-1 rounded-lg bg-[var(--bg)] p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-[var(--bg-elevated)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden rounded-xl border border-[var(--border)]">
        {activeTab === "preview" &&
          (iframeSrc ? (
            <iframe
              src={iframeSrc}
              className="h-full w-full border-0 rounded-xl"
              title={`${demo.name} demo`}
              allow="clipboard-read; clipboard-write; microphone"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-muted)]">
              <p className="text-sm font-semibold text-[var(--text)]">
                No live preview for this demo
              </p>
              <p className="text-xs">
                {demo.name} is a CLI-only demo. See the Docs tab or
                {demo.command ? (
                  <>
                    {" "}
                    run{" "}
                    <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[var(--accent)]">
                      {demo.command}
                    </code>{" "}
                    to get started.
                  </>
                ) : (
                  " the integration page for instructions."
                )}
              </p>
            </div>
          ))}

        {activeTab === "code" && (
          <div className="flex h-full">
            {/* File tabs */}
            <div className="flex h-full flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
              <div className="p-3 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
                Files
              </div>
              {demoContent?.files.map((file, idx) => (
                <button
                  key={file.filename}
                  onClick={() => setActiveFile(idx)}
                  className={`px-4 py-2 text-left text-xs font-mono transition-colors ${
                    activeFile === idx
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
            {/* Code viewer */}
            <div className="flex-1 overflow-auto">
              {demoContent?.files[activeFile] ? (
                <SyntaxHighlighter
                  language={demoContent.files[activeFile].language}
                  style={oneLight}
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    background: "var(--bg)",
                    fontSize: "13px",
                    lineHeight: "1.6",
                  }}
                  showLineNumbers
                  lineNumberStyle={{
                    color: "var(--text-muted)",
                    fontSize: "11px",
                    paddingRight: "1em",
                    minWidth: "3em",
                  }}
                >
                  {demoContent.files[activeFile].content}
                </SyntaxHighlighter>
              ) : (
                <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
                  No source files bundled for this demo.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "docs" && (
          <div className="h-full overflow-auto p-8">
            {demoContent?.readme ? (
              <div className="mx-auto max-w-3xl [&_h1]:text-2xl [&_h1]:font-light [&_h1]:text-[var(--text)] [&_h1]:mb-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--text)] [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--text)] [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:text-sm [&_p]:text-[var(--text-secondary)] [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_li]:text-sm [&_li]:text-[var(--text-secondary)] [&_li]:mb-1 [&_strong]:text-[var(--text)] [&_code]:text-[var(--accent)] [&_code]:bg-[var(--bg-elevated)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-[var(--bg-surface)] [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_hr]:border-[var(--border)] [&_hr]:my-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {demoContent.readme}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
                No documentation available for this demo.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
