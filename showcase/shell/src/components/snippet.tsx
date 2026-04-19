// <Snippet> — server component that resolves a named region from the
// showcase's demo-content bundle and renders it as a code block.
//
// Usage in MDX:
//
//     <Snippet region="provider-setup" framework="langgraph-python" cell="agentic-chat" />
//
// The bundle (`shell/src/data/demo-content.json`) is produced by
// `showcase/scripts/bundle-demo-content.ts` and contains, per demo, a
// `regions` map keyed by region name. Each region records its source file,
// line range, language, and extracted code. Region markers
// (`// @region[...]`, `// @endregion[...]`) are stripped from the bundled
// file contents before they reach the `/code` viewer.
//
// `framework` defaults logic:
//   1. Explicit `framework` prop (highest priority — any page can override)
//   2. `defaultFramework` inferred from the doc page's URL (set by the
//      page renderer via the `FrameworkProvider` context).
//
// When a region can't be found we render a visible warning box rather than
// throwing — docs pages should degrade gracefully while authors iterate.

import React from "react";
import hljs from "highlight.js";
import demoContent from "../data/demo-content.json";

interface Region {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  language: string;
}

interface DemoRecord {
  regions?: Record<string, Region>;
}

const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

interface SnippetProps {
  /** Region name declared via `@region[<name>]` in the cell's source. */
  region: string;
  /**
   * Integration slug — e.g. `langgraph-python`, `mastra`, `pydantic-ai`.
   * When omitted, the component falls back to `defaultFramework` (see below),
   * then to a sensible single-cell heuristic.
   */
  framework?: string;
  /**
   * Cell id — e.g. `agentic-chat`, `tool-rendering`. When omitted we infer
   * it from `defaultCell` (passed by the page) or error with a warning.
   */
  cell?: string;
  /**
   * Optional context defaults, normally threaded in by the docs renderer:
   * reading them from URL/query params or the page's known context.
   */
  defaultFramework?: string;
  defaultCell?: string;
  /** Override the file-path caption. Defaults to the region's source file. */
  title?: string;
  /** Hide the file-path caption. */
  noCaption?: boolean;
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="my-4 rounded-md border-l-4 border-yellow-500/40 bg-yellow-500/5 p-4 text-sm text-[var(--text-secondary)]"
      role="alert"
    >
      <div className="font-semibold mb-1 text-[var(--text)]">
        Missing snippet
      </div>
      {children}
    </div>
  );
}

/** Map the bundler's coarse language hint to an hljs language name. */
function resolveHljsLanguage(lang: string): string | null {
  const map: Record<string, string> = {
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
  return map[lang] ?? null;
}

export function Snippet({
  region,
  framework,
  cell,
  defaultFramework,
  defaultCell,
  title,
  noCaption,
}: SnippetProps) {
  const resolvedFramework = framework ?? defaultFramework;
  const resolvedCell = cell ?? defaultCell;

  if (!resolvedFramework || !resolvedCell) {
    return (
      <WarningBox>
        <code>{`<Snippet region="${region}" />`}</code> was rendered without a
        framework + cell (resolved framework:{" "}
        <code>{resolvedFramework ?? "—"}</code>, cell:{" "}
        <code>{resolvedCell ?? "—"}</code>). Pass them explicitly or configure a
        page default.
      </WarningBox>
    );
  }

  const key = `${resolvedFramework}::${resolvedCell}`;
  const demo = demos[key];
  if (!demo) {
    return (
      <WarningBox>
        No demo found for <code>{key}</code>. Known demos are bundled from
        manifest <code>demos[i]</code>; check the cell id and framework slug.
      </WarningBox>
    );
  }

  const reg = demo.regions?.[region];
  if (!reg) {
    const available = Object.keys(demo.regions ?? {});
    return (
      <WarningBox>
        Region <code>{region}</code> not found in <code>{key}</code>. Tag the
        relevant source lines with <code>{`// @region[${region}]`}</code> /{" "}
        <code>{`// @endregion[${region}]`}</code>.
        {available.length > 0 && (
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Available: {available.join(", ")}
          </div>
        )}
      </WarningBox>
    );
  }

  const hljsLang = resolveHljsLanguage(reg.language);
  let html: string;
  try {
    html = hljsLang
      ? hljs.highlight(reg.code, { language: hljsLang, ignoreIllegals: true })
          .value
      : hljs.highlightAuto(reg.code).value;
  } catch {
    // highlight.js should never throw with ignoreIllegals, but defensively
    // fall back to unhighlighted text rather than crashing the render.
    html = escapeHtml(reg.code);
  }

  const caption = title ?? reg.file;

  return (
    <figure className="my-4 rounded-md border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
      {!noCaption && (
        <figcaption className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-mono text-[var(--text-muted)]">
          <span>{caption}</span>
          <span className="text-[var(--text-faint)]">
            {reg.startLine === reg.endLine
              ? `L${reg.startLine}`
              : `L${reg.startLine}–${reg.endLine}`}
          </span>
        </figcaption>
      )}
      <pre className="text-xs leading-relaxed overflow-x-auto p-4 m-0">
        <code
          className={hljsLang ? `hljs language-${hljsLang}` : "hljs"}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </figure>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
