// <DemoSource> — in-page source viewer used inside <InlineDemo>'s Code
// tab. Reads from the same `demo-content.json` bundle <Snippet> consumes,
// scoped to one (integration, demo) cell.
//
// Defaults to showing only files flagged in the manifest's `highlight:`
// array (rendered in manifest order via `highlightOrder`). Falls back to
// the full bundled file list when nothing is flagged. Pass
// `onlyHighlighted={false}` to always show every file in the cell.
//
// Rendering: Fumadocs's `<CodeBlockTabs>` for the per-file tab strip and
// `<DynamicCodeBlock>` (Shiki at runtime via `useShiki`) for the body of
// each tab. This shares chrome and syntax-highlight theme with the
// authored fenced blocks rendered through MDX, so the Code tab inside
// InlineDemo looks identical to the rest of the page.

"use client";

import React, { useMemo } from "react";
import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from "fumadocs-ui/components/codeblock";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import demoContent from "../data/demo-content.json";

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

// Manifest language slugs → Shiki language names. Shiki recognises most
// slugs directly; this map exists only to disambiguate aliases authors
// write differently from Shiki's canonical names.
const SHIKI_LANGUAGE_MAP: Record<string, string> = {
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

function resolveShikiLanguage(lang: string): string {
  return SHIKI_LANGUAGE_MAP[lang] ?? lang;
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

/**
 * Escape a filename to the radix-tabs `value` format Fumadocs's
 * `<Tabs items={[...]}>` derives internally — lowercase + first
 * whitespace replaced with `-`. Keeps `CodeBlockTabsTrigger` /
 * `CodeBlockTab` value props in sync for radix pairing.
 */
function tabValue(filename: string): string {
  return filename.toLowerCase().replace(/\s/, "-");
}

export function DemoSource({
  integration,
  demo,
  onlyHighlighted = true,
}: DemoSourceProps) {
  const key = `${integration}::${demo}`;
  const record = demos[key];

  const displayFiles: DemoFile[] = useMemo(() => {
    const all = record?.files ?? [];
    if (!onlyHighlighted) return all;
    const flagged = all.filter((f) => f.highlighted);
    if (flagged.length === 0) return all;
    return [...flagged].sort((a, b) => {
      const ao = a.highlightOrder;
      const bo = b.highlightOrder;
      if (ao === undefined && bo === undefined)
        return a.filename.localeCompare(b.filename);
      if (ao === undefined) return 1;
      if (bo === undefined) return -1;
      return ao - bo;
    });
  }, [record, onlyHighlighted]);

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

  const defaultValue = tabValue(displayFiles[0].filename);

  return (
    <CodeBlockTabs defaultValue={defaultValue}>
      <CodeBlockTabsList>
        {displayFiles.map((f) => (
          <CodeBlockTabsTrigger
            key={f.filename}
            value={tabValue(f.filename)}
            title={f.filename}
          >
            {basename(f.filename)}
          </CodeBlockTabsTrigger>
        ))}
      </CodeBlockTabsList>
      {displayFiles.map((f) => (
        <CodeBlockTab key={f.filename} value={tabValue(f.filename)}>
          <DynamicCodeBlock
            lang={resolveShikiLanguage(f.language)}
            code={f.content.replace(/\n$/, "")}
          />
        </CodeBlockTab>
      ))}
    </CodeBlockTabs>
  );
}
