// <Snippet> — server component that resolves code from the showcase's
// demo-content bundle and renders it as a code block.
//
// Two lookup modes:
//
//   1) Named region (preferred when a region marker exists):
//
//        <Snippet region="provider-setup" cell="agentic-chat" />
//
//      Pulls the extracted code for `@region[provider-setup]` inside the
//      cell's source. Regions are authored in the cell with matching
//      `// @region[name]` / `// @endregion[name]` comments and baked into
//      `shell/src/data/demo-content.json` by
//      `showcase/scripts/bundle-demo-content.ts`.
//
//   2) File + optional line range (for arbitrary files, no marker required):
//
//        <Snippet cell="chat-customization-css"
//                 file="src/app/demos/chat-customization-css/theme.css"
//                 lines="1-40" />
//
//      Looks the path up in the bundled `files[]` list and slices to the
//      requested line range. If `lines` is omitted the whole file is shown.
//      Line numbers are 1-indexed and inclusive on both ends. Single-line
//      ranges may be written as `lines="12"`.
//
// If `region` is provided it always wins — `file`/`lines` are ignored in that
// case (this keeps existing call sites working unchanged).
//
// `framework` defaults logic:
//   1. Explicit `framework` prop (highest priority — any page can override)
//   2. `defaultFramework` inferred from the doc page's URL (set by the
//      page renderer via the `FrameworkProvider` context).
//
// When a region/file can't be found we render a visible warning box rather
// than throwing — docs pages should degrade gracefully while authors iterate.

import React from "react";
import demoContent from "../data/demo-content.json";
import catalogData from "../data/catalog.json";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";

interface Region {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  language: string;
}

interface DemoFile {
  filename: string;
  language: string;
  content: string;
  // `highlighted` is whatever the bundler produced — sometimes a string of
  // pre-rendered HTML, sometimes a boolean flag. We don't consume it here.
  highlighted?: unknown;
}

interface DemoRecord {
  regions?: Record<string, Region>;
  files?: DemoFile[];
}

interface WarningMessage {
  warning: string;
}

const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

// Build a `(framework, cell) → catalog entry` lookup at module scope so we
// can detect when a (framework × cell) pair is explicitly flagged
// `unsupported` and render a friendlier placeholder instead of the yellow
// "Missing snippet" warning that fires for genuine docs gaps.
interface CatalogCell {
  id: string;
  integration: string;
  integration_name?: string;
  feature: string;
  feature_name?: string;
  status: string;
}

const catalogByKey: Map<string, CatalogCell> = (() => {
  const m = new Map<string, CatalogCell>();
  const cells = (catalogData as { cells?: CatalogCell[] }).cells ?? [];
  for (const c of cells) {
    m.set(`${c.integration}::${c.feature}`, c);
  }
  return m;
})();

interface SnippetProps {
  /** Region name declared via `@region[<name>]` in the cell's source. */
  region?: string;
  /**
   * Path to a bundled file in the cell (matches `files[i].filename` in
   * `demo-content.json`). Ignored when `region` is also passed.
   */
  file?: string;
  /**
   * Line range within the file — e.g. `"10-20"`, or a single line `"5"`.
   * Applied only when `file` is set. Omit to render the full file.
   */
  lines?: string;
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

/**
 * `UnsupportedBox` — neutral, intentional-looking placeholder used when the
 * dashboard catalog flags a (framework × cell) pair as `unsupported`.
 *
 * Distinct from `WarningBox` (yellow / "something is broken") — this signals
 * "the framework deliberately doesn't implement this feature", which is an
 * expected state, not a docs gap.
 */
function UnsupportedBox({
  integrationName,
  featureName,
}: {
  integrationName: string;
  featureName: string;
}) {
  return (
    <div
      className="my-4 rounded-md border-l-4 border-blue-500/40 bg-blue-500/5 p-4 text-sm text-[var(--text-secondary)]"
      role="note"
    >
      <div className="font-semibold mb-1 text-[var(--text)]">
        Not supported on {integrationName}
      </div>
      <div>
        {integrationName} doesn't support {featureName}. See{" "}
        <a
          href="/"
          className="underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--text-secondary)]"
        >
          the framework grid
        </a>{" "}
        for which integrations support this feature.
      </div>
    </div>
  );
}

/** Map the bundler's coarse language hint to a Shiki language name. */
function resolveShikiLanguage(lang: string): string {
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
  return map[lang] ?? lang;
}

/**
 * Parse a `lines` prop like `"10-20"` or `"5"` into `[start, end]` (1-indexed,
 * inclusive on both ends). Returns null on invalid input.
 *
 * Special forms:
 *   - `"A-"` (trailing dash, no end) — treated as "start to end-of-file"; we
 *     return `[start, Number.POSITIVE_INFINITY]` and the caller clamps to the
 *     actual file length.
 *   - empty string / whitespace — treated as "no range" (equivalent to absent
 *     `lines`), returning null so the caller renders the full file.
 */
function parseLineRange(input: string | undefined): [number, number] | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // `A-` → start through end-of-file (caller clamps).
  const openEnded = trimmed.match(/^(\d+)\s*[-\u2013]\s*$/);
  if (openEnded) {
    const start = parseInt(openEnded[1], 10);
    if (start > 0) return [start, Number.POSITIVE_INFINITY];
    return null;
  }
  const dash = trimmed.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
  if (dash) {
    const start = parseInt(dash[1], 10);
    const end = parseInt(dash[2], 10);
    if (start > 0 && end >= start) return [start, end];
    return null;
  }
  const single = trimmed.match(/^(\d+)$/);
  if (single) {
    const n = parseInt(single[1], 10);
    if (n > 0) return [n, n];
  }
  return null;
}

/**
 * Build a synthetic Region from a DemoFile + optional line range. Used by the
 * file+lines lookup path so the rest of the render pipeline is unchanged.
 */
function regionFromFile(
  file: DemoFile,
  lines?: string,
): Region | WarningMessage {
  // Strip a single trailing newline so line counts and copied text are
  // consistent regardless of whether a `lines=` range is supplied.
  const normalized = file.content.replace(/\n$/, "");
  const allLines = normalized.split("\n");
  if (!lines || lines.trim() === "") {
    return {
      file: file.filename,
      startLine: 1,
      endLine: allLines.length,
      code: normalized,
      language: file.language,
    };
  }
  const range = parseLineRange(lines);
  if (!range) {
    return {
      warning: `Invalid lines="${lines}" — expected "A-B", "A-" (start to end), or single line "A".`,
    };
  }
  const [start, end] = range;
  if (start > allLines.length) {
    return {
      warning: `lines="${lines}" is out of range (file has ${allLines.length} lines).`,
    };
  }
  // Clamp `end` once up front; also warn when the author's explicit range
  // drifted past the file so they notice the source changed under them.
  const effectiveEnd = Math.min(end, allLines.length);
  if (Number.isFinite(end) && end > allLines.length) {
    console.warn(
      `[snippet] lines="${lines}" end (${end}) exceeds file length (${allLines.length}) for ${file.filename} — clamping.`,
    );
  }
  const slice = allLines.slice(start - 1, effectiveEnd).join("\n");
  return {
    file: file.filename,
    startLine: start,
    endLine: effectiveEnd,
    code: slice,
    language: file.language,
  };
}

function isWarning(v: Region | WarningMessage): v is WarningMessage {
  return (v as WarningMessage).warning !== undefined;
}

export function Snippet({
  region,
  file,
  lines,
  framework,
  cell,
  defaultFramework,
  defaultCell,
  // `title` is accepted for source compat but deliberately ignored —
  // the figcaption now always renders the bare filename. Most MDX
  // call sites pass "<path> — <description>" which doubled up on the
  // path that's already implied by surrounding doc context.
  title: _title,
  noCaption,
}: SnippetProps) {
  const resolvedFramework = framework ?? defaultFramework;
  const resolvedCell = cell ?? defaultCell;

  if (!region && !file) {
    return (
      <WarningBox>
        <code>&lt;Snippet /&gt;</code> needs either <code>region</code> or{" "}
        <code>file</code>. Use <code>region="my-region"</code> for tagged blocks
        in the source, or <code>file="src/..." lines="10-20"</code> to pull an
        arbitrary file.
      </WarningBox>
    );
  }

  if (!resolvedFramework) {
    return (
      <div className="my-4 rounded-md border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)] bg-[var(--bg-elevated)]">
        Select an AI backend above to see this code example.
      </div>
    );
  }

  if (!resolvedCell) {
    return (
      <WarningBox>
        <code>{`<Snippet ${region ? `region="${region}"` : `file="${file}"`} />`}</code>{" "}
        was rendered without a cell (resolved framework:{" "}
        <code>{resolvedFramework}</code>, cell: <code>—</code>). Pass{" "}
        <code>cell="..."</code> explicitly or set <code>snippet_cell</code> in
        the page frontmatter.
      </WarningBox>
    );
  }

  const key = `${resolvedFramework}::${resolvedCell}`;

  // If the catalog explicitly marks this (framework × cell) pair as
  // `unsupported`, render a neutral "not supported" placeholder instead of
  // falling through to the yellow "Missing snippet" warning. The latter
  // implies a docs gap that needs filling; the former is an intentional
  // statement that the framework doesn't implement this feature.
  const catalogEntry = catalogByKey.get(key);
  if (catalogEntry?.status === "unsupported") {
    return (
      <UnsupportedBox
        integrationName={catalogEntry.integration_name ?? resolvedFramework}
        featureName={catalogEntry.feature_name ?? resolvedCell}
      />
    );
  }

  const demo = demos[key];
  if (!demo) {
    return (
      <WarningBox>
        No demo found for <code>{key}</code>. Known demos are bundled from
        manifest <code>demos[i]</code>; check the cell id and framework slug.
      </WarningBox>
    );
  }

  // Resolve region — two modes share the same downstream render path.
  let reg: Region;
  if (region) {
    const found = demo.regions?.[region];
    if (!found) {
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
    reg = found;
  } else {
    // file+lines mode
    const demoFile = demo.files?.find((f) => f.filename === file);
    if (!demoFile) {
      const available = (demo.files ?? []).map((f) => f.filename);
      return (
        <WarningBox>
          File <code>{file}</code> not bundled in <code>{key}</code>. Check the
          path (relative to the cell root).
          {available.length > 0 && (
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              Available: {available.slice(0, 6).join(", ")}
              {available.length > 6 ? ` (+${available.length - 6} more)` : ""}
            </div>
          )}
        </WarningBox>
      );
    }
    const result = regionFromFile(demoFile, lines);
    if (isWarning(result)) {
      return <WarningBox>{result.warning}</WarningBox>;
    }
    reg = result;
  }

  // Guard against malformed bundler output — if `demo-content.json` is
  // produced from an in-flight build we could theoretically see a region
  // missing `code` or with non-string `code`. Render a warning rather than
  // letting React crash on `undefined`.
  if (typeof reg.code !== "string") {
    return (
      <WarningBox>
        Snippet for <code>{key}</code> has no <code>code</code> string — check{" "}
        <code>demo-content.json</code> (region/file may be malformed or the
        bundle is out of date).
      </WarningBox>
    );
  }

  // Caption is always the bare filename \u2014 no path, no line range, and
  // we deliberately ignore the `title` prop. Most authors pass titles
  // like "frontend/src/app/page.tsx \u2014 chat surface" which duplicates
  // the path + adds a description; the path is implied by surrounding
  // doc context and the description doesn't earn its real estate next
  // to working code. When `noCaption` is set the title is dropped
  // entirely so the figure's floating copy button sits alone.
  const basename = reg.file.split("/").pop() ?? reg.file;
  const caption = noCaption ? undefined : basename;

  return (
    <DynamicCodeBlock
      lang={resolveShikiLanguage(reg.language)}
      code={reg.code}
      codeblock={caption ? { title: caption } : undefined}
    />
  );
}
