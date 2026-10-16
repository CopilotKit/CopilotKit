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
import angularSourceContent from "../data/angular-source-content.json";
import type { FrontendId } from "../lib/frontend-options";

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

const angularFiles = (
  angularSourceContent as {
    files: Record<string, { language: string; content: string }>;
  }
).files;

// Every Angular sub-agent page uses this Showcase feature. Each integration
// keeps its own backend files from the demo manifest.
const ANGULAR_SUBAGENTS_FILES = [
  "features/agent-state/agent-state-feature.component.ts",
  "features/agent-state/agent-state-cards.ts",
  "features/agent-state/agent-state-model.ts",
  "features/agent-state/subagent-renderer-config.ts",
  "app.routes.ts",
  "feature-agent.ts",
];

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
      className="shell-docs-radius-surface shell-docs-warning-surface my-4 border border-l-4 p-4 text-sm text-[var(--text-secondary)] shadow-[var(--shadow-control)]"
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
  /** Frontend selected by the docs URL. */
  frontend?: FrontendId;
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
  frontend,
}: DemoSourceProps) {
  const key = `${integration}::${demo}`;
  const record = demos[key];

  const displayFiles: DemoFile[] = useMemo(() => {
    const all = record?.files ?? [];
    if (record && frontend === "angular" && demo === "subagents") {
      const backend = all.filter(
        (file) => !file.filename.startsWith("src/app/demos/subagents/"),
      );
      const highlightedBackend = backend.filter((file) => file.highlighted);
      return [
        ...ANGULAR_SUBAGENTS_FILES.flatMap((filename) => {
          const source = angularFiles[filename];
          return source
            ? [
                {
                  ...source,
                  filename: `showcase/angular/src/app/${filename}`,
                },
              ]
            : [];
        }),
        ...(onlyHighlighted && highlightedBackend.length > 0
          ? [...highlightedBackend].sort(
              (a, b) => (a.highlightOrder ?? 0) - (b.highlightOrder ?? 0),
            )
          : backend),
      ];
    }
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
  }, [record, onlyHighlighted, frontend, demo]);

  if (!record) {
    return (
      <WarningBox>
        No demo found for <code>{key}</code>. Check the integration slug and
        demo id (matches manifest <code>slug</code> / <code>demos[i].id</code>
        ).
      </WarningBox>
    );
  }

  const missingAngularFile =
    frontend === "angular" && demo === "subagents"
      ? ANGULAR_SUBAGENTS_FILES.find((filename) => !angularFiles[filename])
      : undefined;
  if (missingAngularFile) {
    return (
      <WarningBox>
        Angular source <code>{missingAngularFile}</code> is missing from the
        bundled Showcase files.
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
