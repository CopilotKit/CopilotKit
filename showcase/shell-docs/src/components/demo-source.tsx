// <DemoSource> — in-shell-docs source viewer that replaces the deprecated
// feature-viewer iframe in <InlineDemo>'s Code tab. Reads from the same
// `demo-content.json` bundle <Snippet> consumes, scoped to one
// (integration, demo) cell.
//
// Defaults to showing only files flagged in the manifest's `highlight:`
// array (rendered in manifest order via `highlightOrder`). Falls back to
// the full bundled file list when nothing is flagged. Pass
// `onlyHighlighted={false}` to always show every file in the cell.
//
// Why "use client": we run highlight.js in the browser so each tab's code
// only gets syntax-highlighted on demand. The ~50 KB hljs cost is
// acceptable for cutover; a server-pre-render split is a post-cutover
// refactor.

"use client";

import React, { useMemo, useState } from "react";
import hljs from "highlight.js";
import demoContent from "../data/demo-content.json";
import { CopyButton } from "./copy-button";

interface DemoFile {
  filename: string;
  language: string;
  content: string;
  highlighted?: boolean;
  highlightOrder?: number;
}

interface DemoRecord {
  files?: DemoFile[];
}

const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

// Mirrors <Snippet>'s language map so the two viewers highlight the same
// languages identically. Kept private to avoid creating a public hljs API
// surface for docs components.
const HLJS_LANGUAGE_MAP: Record<string, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  csharp: "csharp",
  css: "css",
  json: "json",
  yaml: "yaml",
  markdown: "markdown",
  text: "plaintext",
};

function resolveHljsLanguage(lang: string): string | null {
  return HLJS_LANGUAGE_MAP[lang] ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="my-4 rounded-md border-l-4 border-yellow-500/40 bg-yellow-500/5 p-4 text-sm text-[var(--text-secondary)]"
      role="alert"
    >
      <div className="font-semibold mb-1 text-[var(--text)]">
        Missing demo source
      </div>
      {children}
    </div>
  );
}

interface DemoSourceProps {
  /** Integration slug, e.g. `langgraph-python`. Used directly as the
   *  bundle key prefix — no `getDocsFolder` translation. */
  integration: string;
  /** Demo id, e.g. `agentic-chat`. Matches manifest `demos[i].id`. */
  demo: string;
  /**
   * When true (default), only files flagged `highlighted: true` in the
   * manifest are shown, sorted by `highlightOrder`. If no files are
   * flagged, falls back to showing all files so the Code tab is never
   * blank. Pass `false` to always show every file in the cell.
   */
  onlyHighlighted?: boolean;
}

export function DemoSource({
  integration,
  demo,
  onlyHighlighted = true,
}: DemoSourceProps) {
  const key = `${integration}::${demo}`;
  const record = demos[key];

  // Resolve the displayed file list once per (key, onlyHighlighted) pair.
  // Memoising keeps the active-file index stable across re-renders that
  // don't change the inputs (e.g. parent state churn).
  const displayFiles: DemoFile[] = useMemo(() => {
    const all = record?.files ?? [];
    if (!onlyHighlighted) return all;
    const flagged = all.filter((f) => f.highlighted);
    if (flagged.length === 0) return all;
    return [...flagged].sort((a, b) => {
      // Files flagged without a numeric order (defensive — shouldn't happen
      // with the current bundler) sort after ordered files in stable
      // filename order.
      const ao = a.highlightOrder;
      const bo = b.highlightOrder;
      if (ao === undefined && bo === undefined)
        return a.filename.localeCompare(b.filename);
      if (ao === undefined) return 1;
      if (bo === undefined) return -1;
      return ao - bo;
    });
  }, [record, onlyHighlighted]);

  const [activeIdx, setActiveIdx] = useState(0);

  if (!record) {
    return (
      <WarningBox>
        No demo found for <code>{key}</code>. Check the integration slug and
        demo id (matches manifest <code>slug</code> / <code>demos[i].id</code>
        ).
      </WarningBox>
    );
  }

  if (displayFiles.length === 0) {
    return (
      <WarningBox>
        Demo <code>{key}</code> has no bundled source files. The manifest may be
        missing a <code>route:</code> or its demo folder is empty.
      </WarningBox>
    );
  }

  // Clamp activeIdx against the list length so a previously-selected index
  // never points past the end after the file list shrinks (e.g. a manifest
  // edit removes a highlighted file mid-session in dev).
  const safeActiveIdx = Math.min(activeIdx, displayFiles.length - 1);
  const active = displayFiles[safeActiveIdx];
  const normalized = active.content.replace(/\n$/, "");
  const lineCount = normalized.split("\n").length;
  const hljsLang = resolveHljsLanguage(active.language);

  let html: string;
  let highlightFailed = false;
  try {
    html = hljsLang
      ? hljs.highlight(normalized, { language: hljsLang, ignoreIllegals: true })
          .value
      : hljs.highlightAuto(normalized).value;
  } catch (err) {
    console.warn(
      `[demo-source] highlight failed for ${key} ${active.filename} (language=${active.language})`,
      err,
    );
    html = escapeHtml(normalized);
    highlightFailed = true;
  }
  if (typeof html !== "string") {
    html = escapeHtml(normalized);
    highlightFailed = true;
  }

  const codeClassName = highlightFailed
    ? undefined
    : hljsLang
      ? `hljs language-${hljsLang}`
      : "hljs";

  return (
    <figure className="my-5 rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1">
        {displayFiles.map((f, i) => {
          const isActive = i === safeActiveIdx;
          return (
            <button
              key={f.filename}
              type="button"
              onClick={() => setActiveIdx(i)}
              title={f.filename}
              className={
                "shrink-0 rounded px-2 py-1 text-[11px] font-mono transition-colors " +
                (isActive
                  ? "bg-[var(--bg-surface)] text-[var(--text)] border border-[var(--border)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]")
              }
            >
              {basename(f.filename)}
            </button>
          );
        })}
      </div>
      <figcaption className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] font-mono text-[var(--text-muted)]">
        <span className="truncate">{active.filename}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[var(--text-faint)]">{active.language}</span>
          <span className="text-[var(--text-faint)]">
            {lineCount === 1 ? "1 line" : `${lineCount} lines`}
          </span>
          <CopyButton text={normalized} />
        </div>
      </figcaption>
      <pre className="text-[12.5px] leading-[1.55] overflow-x-auto p-4 m-0">
        <code
          className={codeClassName}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </figure>
  );
}
