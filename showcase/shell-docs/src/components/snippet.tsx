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
import hljs from "highlight.js";
import demoContent from "../data/demo-content.json";
import { CopyButton } from "./copy-button";

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

interface SnippetProps {
  /** Region name declared via `@region[<name>]` in the cell's source. */
  region?: string;
  /**
   * Path to a bundled file in the cell (matches `files[i].filename` in
   * `demo-content.json`). Ignored when `region` is also passed.
   */
  file?: string;
  /**
   * Line range within the file — e.g. `"10-20"`, a single line `"5"`, or a
   * comma-separated list of ranges `"1-5,10-15"` (concatenated with a
   * `// ...` separator between discontinuous sections). Applied only when
   * `file` is set. Omit to render the full file.
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

// Track languages we've already warned about so each unknown language name
// only produces one console message per process, regardless of how many
// <Snippet>s reference it.
const warnedUnknownLanguages = new Set<string>();

/** Map the bundler's coarse language hint to an hljs language name. */
function resolveHljsLanguage(lang: string): string | null {
  const map: Record<string, string> = {
    typescript: "typescript",
    // JSX/TSX are highlighted by hljs's javascript/typescript grammars
    // respectively — explicit entries here avoid the highlightAuto
    // fallback + the one-shot "unknown language" warning below.
    tsx: "typescript",
    javascript: "javascript",
    jsx: "javascript",
    python: "python",
    csharp: "csharp",
    css: "css",
    json: "json",
    yaml: "yaml",
    markdown: "markdown",
    text: "plaintext",
    // Shell-family hints all resolve to hljs's "bash" grammar. sh/shell
    // are the common bundler hints; bash is a no-op passthrough so future
    // additions don't regress.
    sh: "bash",
    bash: "bash",
    shell: "bash",
  };
  const mapped = map[lang];
  if (mapped) return mapped;
  if (lang && !warnedUnknownLanguages.has(lang)) {
    warnedUnknownLanguages.add(lang);
    console.warn(
      `[snippet] unknown language "${lang}" — falling back to hljs.highlightAuto. ` +
        `Add it to resolveHljsLanguage() for deterministic highlighting.`,
    );
  }
  return null;
}

/**
 * Parse a single segment of a `lines` prop — one of `"10-20"`, `"5"`, or
 * `"A-"` — into `[start, end]` (1-indexed, inclusive on both ends). Returns
 * null on invalid input.
 *
 * Special forms:
 *   - `"A-"` (trailing dash, no end) — treated as "start to end-of-file"; we
 *     return `[start, Number.POSITIVE_INFINITY]` and the caller clamps to the
 *     actual file length.
 */
function parseSingleRange(segment: string): [number, number] | null {
  const trimmed = segment.trim();
  if (trimmed === "") return null;
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
 * Parse a `lines` prop into an ordered list of `[start, end]` tuples.
 * Accepts a comma-separated list of segments — e.g. `"1-5,10-15"` yields
 * `[[1,5],[10,15]]`. Segments may be single lines, closed ranges, or an
 * open-ended range (`"A-"`); see `parseSingleRange` for the grammar.
 *
 * Returns null when:
 *   - input is absent / whitespace (caller treats as "no range")
 *   - any segment is malformed (the whole prop is rejected so authors get
 *     a single clear error instead of partial rendering)
 */
function parseLineRange(
  input: string | undefined,
): Array<[number, number]> | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const segments = trimmed.split(",");
  const ranges: Array<[number, number]> = [];
  for (const seg of segments) {
    const r = parseSingleRange(seg);
    if (!r) return null;
    ranges.push(r);
  }
  return ranges.length > 0 ? ranges : null;
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
  const ranges = parseLineRange(lines);
  if (!ranges) {
    return {
      warning: `Invalid lines="${lines}" — expected "A-B", "A-" (start to end), a single line "A", or a comma-separated list like "1-5,10-15".`,
    };
  }
  // Validate every range is in bounds before slicing so authors get a
  // single clear error rather than partial output.
  for (const [start] of ranges) {
    if (start > allLines.length) {
      return {
        warning: `lines="${lines}" is out of range (file has ${allLines.length} lines).`,
      };
    }
  }
  // Slice each range, clamp ends, and stitch with a visual separator line
  // between discontinuous sections. `startLine`/`endLine` in the caption
  // span the full range (first start → last clamped end) so readers see
  // where the snippet pulls from even when it's non-contiguous.
  const pieces: string[] = [];
  let firstStart = ranges[0][0];
  let lastEnd = ranges[0][0];
  ranges.forEach(([start, end], idx) => {
    const effectiveEnd = Math.min(end, allLines.length);
    if (Number.isFinite(end) && end > allLines.length) {
      console.warn(
        `[snippet] lines="${lines}" segment end (${end}) exceeds file length (${allLines.length}) for ${file.filename} — clamping.`,
      );
    }
    if (idx === 0) firstStart = start;
    lastEnd = effectiveEnd;
    const slice = allLines.slice(start - 1, effectiveEnd).join("\n");
    if (idx > 0) {
      // Use a comment-style ellipsis that survives any highlighter as a
      // visible gap marker. Language-specific comment syntax varies, so
      // `// ...` is a reasonable default for the JS/TS/shell bulk; pure
      // "..." renders fine across all grammars even when it isn't
      // technically a comment.
      pieces.push("// ...");
    }
    pieces.push(slice);
  });
  return {
    file: file.filename,
    startLine: firstStart,
    endLine: lastEnd,
    code: pieces.join("\n"),
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
  title,
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

  if (!resolvedFramework || !resolvedCell) {
    return (
      <WarningBox>
        <code>{`<Snippet ${region ? `region="${region}"` : `file="${file}"`} />`}</code>{" "}
        was rendered without a framework + cell (resolved framework:{" "}
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

  const hljsLang = resolveHljsLanguage(reg.language);
  let html: string;
  let highlightFailed = false;
  try {
    html = hljsLang
      ? hljs.highlight(reg.code, { language: hljsLang, ignoreIllegals: true })
          .value
      : hljs.highlightAuto(reg.code).value;
  } catch (err) {
    // highlight.js should never throw with ignoreIllegals, but defensively
    // fall back to unhighlighted text rather than crashing the render. Log
    // enough context that authors can find the offending snippet.
    console.warn(
      `[snippet] highlight failed for ${key} ${reg.file} (language=${reg.language})`,
      err,
    );
    html = escapeHtml(reg.code);
    highlightFailed = true;
  }
  // Defense-in-depth: if hljs ever returns a non-string (unknown edge case),
  // fall back to escaped plain text so `dangerouslySetInnerHTML` can't
  // receive garbage.
  if (typeof html !== "string") {
    html = escapeHtml(reg.code);
    highlightFailed = true;
  }

  const caption = title ?? reg.file;
  // When highlighting failed we render escaped plain text; drop the `hljs`
  // class so the output doesn't get styled as though it were highlighted.
  const codeClassName = highlightFailed
    ? undefined
    : hljsLang
      ? `hljs language-${hljsLang}`
      : "hljs";

  return (
    <figure className="my-5 rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
      {!noCaption && (
        <figcaption className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] font-mono text-[var(--text-muted)]">
          <span className="truncate">{caption}</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[var(--text-faint)]">
              {reg.startLine === reg.endLine
                ? `L${reg.startLine}`
                : `L${reg.startLine}\u2013${reg.endLine}`}
            </span>
            <CopyButton text={reg.code} />
          </div>
        </figcaption>
      )}
      <pre className="text-[12.5px] leading-[1.55] overflow-x-auto p-4 m-0">
        <code
          className={codeClassName}
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
