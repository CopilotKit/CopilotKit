"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { DemoDrawer } from "@/components/demo-drawer";

interface Demo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  route?: string;
  command?: string;
  animated_preview_url?: string | null;
}

interface Integration {
  name: string;
  slug: string;
  category: string;
  language: string;
  logo?: string;
  description: string;
  partner_docs: string | null;
  repo: string;
  copilotkit_version?: string;
  backend_url: string;
  deployed: boolean;
  generative_ui?: string[];
  interaction_modalities?: string[];
  sort_order?: number;
  managed_platform?: { name: string; url: string };
  animated_preview_url?: string | null;
  starter?: {
    path: string;
    name: string;
    description?: string;
    github_url?: string;
    demo_url?: string;
    clone_command?: string;
  };
  features: string[];
  demos: Demo[];
}

interface StarterFile {
  filename: string;
  language: string;
  content: string;
}

interface FeatureInfo {
  id: string;
  name: string;
  hasDemo: boolean;
}

export function ProfileClient({
  integration,
  featureInfos,
  categoryLabel,
  languageLabel,
  demoAlternatives = {},
}: {
  integration: Integration;
  featureInfos: FeatureInfo[];
  categoryLabel: string;
  languageLabel: string;
  demoAlternatives?: Record<
    string,
    Array<{ slug: string; name: string; backendUrl: string }>
  >;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeDemo, setActiveDemo] = useState<Demo | null>(null);
  const [starterFiles, setStarterFiles] = useState<StarterFile[] | null>(null);
  const [starterReadme, setStarterReadme] = useState<string | null>(null);
  const [starterTab, setStarterTab] = useState<"demo" | "code" | "docs">(
    "demo",
  );
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [cloneCopied, setCloneCopied] = useState(false);
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);

  const liveDemos = integration.demos.filter((d) => d.route && !d.command);
  const commandDemos = integration.demos.filter((d) => d.command);

  // Load starter content dynamically when the integration has a starter
  useEffect(() => {
    if (!integration.starter) return;
    let cancelled = false;
    import("@/data/starter-content.json")
      .then((mod) => {
        if (cancelled) return;
        const content = mod.default as any;
        const starterData = content.starters[integration.slug];
        if (starterData) {
          setStarterFiles(starterData.files || []);
          setStarterReadme(starterData.readme || null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[profile] Failed to load starter content:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [integration.slug, integration.starter]);

  function openDemo(demo: Demo) {
    setActiveDemo(demo);
    setDrawerOpen(true);
  }

  function copyDemoCommand(demoId: string, command: string) {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopiedCommandId(demoId);
        setTimeout(() => setCopiedCommandId(null), 2000);
      })
      .catch(() => {
        window.prompt("Copy this command:", command);
      });
  }

  function copyCloneCommand() {
    if (!integration.starter) return;
    const cmd =
      integration.starter.clone_command ||
      `npx degit CopilotKit/CopilotKit/${integration.starter.path} my-copilotkit-app`;
    navigator.clipboard
      .writeText(cmd)
      .then(() => {
        setCloneCopied(true);
        setTimeout(() => setCloneCopied(false), 2000);
      })
      .catch(() => {
        // Fallback: show the command in a prompt if clipboard fails
        window.prompt("Copy this command:", cmd);
      });
  }

  // Find the "key" agent file — prefer a Python file with "agent" or "main" in the name, else first backend file
  const keyFile = starterFiles
    ? starterFiles.find(
        (f) => /agent|main/.test(f.filename) && f.language === "python",
      ) ||
      starterFiles.find((f) => f.language === "python") ||
      starterFiles[0]
    : null;

  return (
    <>
      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3">
            {integration.logo && (
              <img
                src={integration.logo}
                alt={`${integration.name} logo`}
                className="w-10 h-10 rounded-lg"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <h1 className="text-3xl font-light text-[var(--text)]">
              {integration.name}
            </h1>
            <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)] border border-[var(--border)]">
              {languageLabel}
            </span>
          </div>
          <p className="mt-1 text-xs font-mono uppercase tracking-widest text-[var(--accent)]">
            {categoryLabel}
          </p>
          <p className="mt-4 text-[var(--text-secondary)] max-w-2xl leading-relaxed">
            {integration.description}
          </p>
        </div>

        {/* Links */}
        <div className="mt-6 flex flex-wrap gap-3">
          {integration.partner_docs && (
            <a
              href={integration.partner_docs}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text-muted)] transition-colors"
            >
              Partner Docs
            </a>
          )}
          <a
            href={integration.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text-muted)] transition-colors"
          >
            Source Code
          </a>
          <a
            href="https://github.com/CopilotKit/CopilotKit/blob/main/showcase/STYLING-GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text-muted)] transition-colors"
          >
            Developer Guide
          </a>
        </div>
      </div>

      {/* Full Starter — wider breakout container */}
      {integration.starter && keyFile && (
        <div className="mx-auto max-w-[90rem] px-6">
          <section className="mt-0">
            <div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--bg-elevated)] p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text)]">
                    <span className="text-xl">🚀</span>
                    Full Starter: {integration.starter.name}
                  </h2>
                  {integration.starter.description && (
                    <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
                      {integration.starter.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Tab bar */}
              <div className="mt-4 flex gap-1">
                {[
                  { id: "demo" as const, label: "Live Demo" },
                  { id: "code" as const, label: "Code" },
                  { id: "docs" as const, label: "Docs" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setStarterTab(tab.id)}
                    className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      starterTab === tab.id
                        ? "bg-[var(--bg-surface)] text-[var(--text)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="mt-4">
                {/* Live Demo tab */}
                {starterTab === "demo" && (
                  <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                    {integration.starter.demo_url ? (
                      <iframe
                        src={integration.starter.demo_url}
                        className="w-full rounded-lg border border-[var(--border)]"
                        style={{ height: "min(80vh, 900px)" }}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex items-center justify-center py-20 text-sm text-[var(--text-muted)]">
                        Coming soon — deploy in progress
                      </div>
                    )}
                  </div>
                )}

                {/* Code tab */}
                {starterTab === "code" && (
                  <>
                    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
                        <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                          {keyFile.filename}
                        </span>
                      </div>
                      <SyntaxHighlighter
                        language={keyFile.language}
                        style={oneLight}
                        customStyle={{
                          margin: 0,
                          borderRadius: 0,
                          background: "var(--bg-surface)",
                          fontSize: "13px",
                          lineHeight: "1.6",
                          padding: "16px 20px",
                          maxHeight: showAllFiles ? "none" : "none",
                        }}
                        showLineNumbers
                        lineNumberStyle={{
                          color: "var(--text-faint)",
                          fontSize: "11px",
                          paddingRight: "1em",
                          minWidth: "3em",
                        }}
                      >
                        {showAllFiles
                          ? keyFile.content
                          : keyFile.content.split("\n").slice(0, 30).join("\n")}
                      </SyntaxHighlighter>
                    </div>

                    {/* Show all files toggle */}
                    {starterFiles && starterFiles.length > 1 && (
                      <div className="mt-4">
                        <button
                          onClick={() => setShowAllFiles(!showAllFiles)}
                          className="text-xs font-medium text-[var(--accent)] hover:underline transition-colors"
                        >
                          {showAllFiles
                            ? "Show less ▲"
                            : `Show all ${starterFiles.length} files ▼`}
                        </button>

                        {showAllFiles && (
                          <div className="mt-3 space-y-3">
                            {starterFiles
                              .filter((f) => f.filename !== keyFile.filename)
                              .map((file, idx) => (
                                <div
                                  key={`${file.filename}-${idx}`}
                                  className="rounded-lg border border-[var(--border)] overflow-hidden"
                                >
                                  <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
                                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                                      {file.filename}
                                    </span>
                                  </div>
                                  <SyntaxHighlighter
                                    language={file.language}
                                    style={oneLight}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      background: "var(--bg-surface)",
                                      fontSize: "13px",
                                      lineHeight: "1.6",
                                      padding: "16px 20px",
                                    }}
                                    showLineNumbers
                                    lineNumberStyle={{
                                      color: "var(--text-faint)",
                                      fontSize: "11px",
                                      paddingRight: "1em",
                                      minWidth: "3em",
                                    }}
                                  >
                                    {file.content}
                                  </SyntaxHighlighter>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Docs tab */}
                {starterTab === "docs" && (
                  <div
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6 overflow-auto"
                    style={{ maxHeight: "600px" }}
                  >
                    {starterReadme ? (
                      <div className="max-w-none [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-[var(--text)] [&_h1]:mb-3 [&_h1]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--text)] [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--text)] [&_h3]:mt-4 [&_h3]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-[var(--text)] [&_h4]:mt-3 [&_h4]:mb-1 [&_p]:text-sm [&_p]:text-[var(--text-secondary)] [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:text-sm [&_li]:text-[var(--text-secondary)] [&_li]:mb-1 [&_strong]:text-[var(--text)] [&_code]:text-[var(--accent)] [&_code]:bg-[var(--bg-elevated)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-[var(--bg-elevated)] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_a]:text-[var(--accent)] [&_a]:underline [&_details]:mb-3 [&_details]:text-sm [&_summary]:cursor-pointer [&_summary]:font-medium [&_summary]:text-[var(--text)] [&_hr]:border-[var(--border)] [&_hr]:my-4">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}
                        >
                          {starterReadme}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--text-muted)]">
                        No README available for this starter.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons (below tabs) */}
              <div className="mt-4 flex flex-wrap gap-3">
                {integration.starter.github_url && (
                  <a
                    href={integration.starter.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:opacity-90 transition-opacity"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    View on GitHub
                  </a>
                )}
                <button
                  onClick={copyCloneCommand}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text-muted)] transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  {cloneCopied ? "Copied!" : "Clone"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-6 pb-12">
        {/* Get Started — CLI / command-only entries */}
        {commandDemos.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Get Started
            </h2>
            <div className="space-y-3">
              {commandDemos.map((demo) => (
                <div
                  key={demo.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5"
                >
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    {demo.name}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {demo.description}
                  </p>
                  <div className="mt-3 flex items-start gap-2">
                    <code className="flex-1 min-w-0 whitespace-pre-wrap break-all rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-mono text-[var(--text)]">
                      {demo.command}
                    </code>
                    <button
                      onClick={() =>
                        copyDemoCommand(demo.id, demo.command ?? "")
                      }
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text-muted)] transition-colors"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                      {copiedCommandId === demo.id ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Demos */}
        {liveDemos.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Live Demos
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {liveDemos.map((demo) => (
                <button
                  key={demo.id}
                  onClick={() => openDemo(demo)}
                  className="group text-left rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 hover:border-[var(--accent)] hover:-translate-y-0.5 transition-all"
                >
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    {demo.name}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {demo.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {demo.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Full page viewer link */}
        {activeDemo && (
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            <Link
              href={`/integrations/${integration.slug}/${activeDemo.id}`}
              className="text-[var(--accent)] hover:underline"
            >
              Open in full page →
            </Link>
          </p>
        )}
      </div>

      {/* Drawer */}
      {activeDemo && (
        <DemoDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          integrationSlug={integration.slug}
          integrationName={integration.name}
          demoId={activeDemo.id}
          demoName={activeDemo.name}
          backendUrl={integration.backend_url}
          demoRoute={activeDemo.route ?? ""}
          wide={
            activeDemo.id.includes("gen-ui") ||
            activeDemo.id.includes("shared-state") ||
            activeDemo.id.includes("subagent")
          }
          alternatives={demoAlternatives[activeDemo.id]}
        />
      )}
    </>
  );
}
