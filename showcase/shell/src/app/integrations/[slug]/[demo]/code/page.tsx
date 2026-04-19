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
  highlighted?: boolean;
}

interface DemoContent {
  readme: string | null;
  files: DemoFile[];
  backend_files?: DemoFile[];
}

type TreeNode =
  | { kind: "file"; file: DemoFile; name: string }
  | { kind: "dir"; name: string; children: TreeNode[] };

function buildTree(files: DemoFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.filename.split("/");
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      let existing = level.find(
        (n): n is Extract<TreeNode, { kind: "dir" }> =>
          n.kind === "dir" && n.name === dirName,
      );
      if (!existing) {
        existing = { kind: "dir", name: dirName, children: [] };
        level.push(existing);
      }
      level = existing.children;
    }
    level.push({ kind: "file", file, name: parts[parts.length - 1] });
  }
  // Sort each level: directories first, then files; alpha within each group;
  // but highlighted files float to top within their group.
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      if (a.kind === "file" && b.kind === "file") {
        if (!!a.file.highlighted !== !!b.file.highlighted) {
          return a.file.highlighted ? -1 : 1;
        }
      }
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.kind === "dir") sort(n.children);
  };
  sort(root);
  return root;
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

function FileTree({
  nodes,
  depth,
  activeFilename,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  activeFilename?: string;
  onSelect: (f: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const indent = { paddingLeft: `${12 + depth * 14}px` };
        if (node.kind === "dir") {
          return (
            <div key={`d:${node.name}:${depth}`}>
              <div
                className="py-1 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]"
                style={indent}
              >
                {node.name}/
              </div>
              <FileTree
                nodes={node.children}
                depth={depth + 1}
                activeFilename={activeFilename}
                onSelect={onSelect}
              />
            </div>
          );
        }
        const active = activeFilename === node.file.filename;
        const hl = node.file.highlighted;
        return (
          <button
            key={`f:${node.file.filename}`}
            onClick={() => onSelect(node.file.filename)}
            style={indent}
            className={`block w-full py-1.5 pr-3 text-left text-xs font-mono transition-colors truncate ${
              active
                ? "bg-[var(--bg-elevated)] text-[var(--text)]"
                : hl
                  ? "text-[var(--text)] hover:bg-[var(--bg-elevated)]/50"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/50"
            } ${hl ? "font-semibold" : ""}`}
            title={hl ? "core file" : undefined}
          >
            {hl && <span className="text-[var(--accent)] mr-1">★</span>}
            {node.name}
          </button>
        );
      })}
    </>
  );
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

  const hasHighlights = useMemo(
    () => allFiles.some((f) => f.highlighted),
    [allFiles],
  );

  // `view` toggles the sidebar between "core" (highlights only) and "all"
  // (full tree). Default is "core" when any file is highlighted; otherwise
  // "all" (with nothing marked core, core view would be empty).
  const view: "core" | "all" =
    searchParams.get("view") === "all" ? "all" : hasHighlights ? "core" : "all";

  const visibleFiles: DemoFile[] = useMemo(
    () => (view === "core" ? allFiles.filter((f) => f.highlighted) : allFiles),
    [allFiles, view],
  );

  // Default-open a highlighted file if any; otherwise the first file.
  const defaultFile =
    allFiles.find((f) => f.highlighted)?.filename ?? allFiles[0]?.filename;
  const activeFilename = searchParams.get("file") ?? defaultFile;
  const activeFile =
    allFiles.find((f) => f.filename === activeFilename) ?? allFiles[0];
  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

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

  const setView = (v: "core" | "all") => {
    const next = new URLSearchParams(searchParams.toString());
    if (v === "all") next.set("view", "all");
    else next.delete("view"); // "core" is default — omit the param
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="flex h-[calc(100vh-52px)]">
      <div className="flex h-full w-64 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Files
          </span>
          {hasHighlights && (
            <label
              className="flex items-center gap-2 cursor-pointer select-none"
              title="Include scaffolding (Dockerfile, configs, etc.)"
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
                show all files
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={view === "all"}
                onClick={() => setView(view === "all" ? "core" : "all")}
                className={`relative inline-block h-4 w-7 rounded-full border transition-colors ${
                  view === "all"
                    ? "bg-[var(--accent)] border-[var(--accent)]"
                    : "bg-[var(--bg-muted)] border-[var(--border-strong)]"
                }`}
              >
                <span
                  className={`absolute top-[1px] left-[1px] h-3 w-3 rounded-full shadow-sm transition-transform ${
                    view === "all"
                      ? "bg-white translate-x-3"
                      : "bg-[var(--text-muted)] translate-x-0"
                  }`}
                />
              </button>
            </label>
          )}
        </div>
        <div className="overflow-y-auto flex-1">
          <FileTree
            nodes={tree}
            depth={0}
            activeFilename={activeFile?.filename}
            onSelect={selectFile}
          />
        </div>
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
