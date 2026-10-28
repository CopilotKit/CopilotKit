// <Snippet>: code from a showcase cell, rendered like an MDX code fence.
// A port of shell-docs' src/components/snippet.tsx.
//
//   <Snippet region="provider-setup" cell="agentic-chat" />
//     the `@region[provider-setup]` block of the cell's source, or
//   <Snippet cell="chat-customization-css" file="src/app/.../theme.css" lines="1-40" />
//     a bundled file, optionally sliced to a 1-based inclusive line range.
//
// `region` wins over `file`. The framework is the explicit `framework` prop,
// else the page's URL framework, else the page's `snippet_framework`
// frontmatter (injected as `defaultFramework`); the cell is `cell`, else the
// page's `snippet_cell` (`defaultCell`). A missing region or file renders a
// visible notice instead of throwing, so pages degrade while authors iterate.

import type { ReactNode } from "react";
import Link from "next/link";
import { Callout } from "fumadocs-ui/components/callout";
import { DocsCode } from "../code";
import { getCatalogCell, getDemoRecord, type DemoFile } from "../data";
import type { DocsScope } from "../scope";

export interface SnippetProps {
  /** Region name declared via `@region[<name>]` in the cell's source. */
  region?: string;
  /** A bundled file in the cell (`files[i].filename`); ignored with `region`. */
  file?: string;
  /** `"10-20"`, `"5"`, or `"10-"` (to the end); only with `file`. */
  lines?: string;
  /** Integration slug, e.g. `mastra`. */
  framework?: string;
  /** Cell id, e.g. `agentic-chat`. */
  cell?: string;
  /** Injected from the page's `snippet_framework` frontmatter. */
  defaultFramework?: string;
  /** Injected from the page's `snippet_cell` frontmatter. */
  defaultCell?: string;
  /** Accepted for source compatibility; the caption is always the file name. */
  title?: string;
  /** Hide the file-name caption. */
  noCaption?: boolean;
  /** Lines to emphasize, relative to the snippet: `"1-6"`, `"3,5-"`. */
  highlight?: string;
}

interface Region {
  file: string;
  code: string;
  language: string;
}

/** shell-docs' WarningBox: a docs gap the author should fix. */
function MissingSnippet({
  title = "Missing snippet",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Callout type="warn" title={title} role="alert">
      {children}
    </Callout>
  );
}

/**
 * The framework deliberately doesn't implement this feature: an expected
 * state the catalog records, not a docs gap.
 */
export function UnsupportedBox({
  integrationName,
  featureName,
}: {
  integrationName: string;
  featureName: string;
}) {
  return (
    <Callout type="info" title={`Not supported on ${integrationName}`}>
      {integrationName} doesn&apos;t support {featureName}. See{" "}
      <Link href="/">the framework grid</Link> for which integrations support this
      feature.
    </Callout>
  );
}

/** The bundler's coarse language hints, as Shiki language names. */
const SHIKI_LANGUAGE: Record<string, string> = { text: "plaintext" };

export function shikiLanguage(lang: string): string {
  return SHIKI_LANGUAGE[lang] ?? lang;
}

/**
 * `"10-20"` or `"5"` to `[start, end]`, 1-based and inclusive; `"10-"` runs
 * to the end (`Infinity`, clamped by the caller). Empty means no range.
 */
function parseLineRange(input: string | undefined): [number, number] | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const open = trimmed.match(/^(\d+)\s*[-–]\s*$/);
  if (open) {
    const start = Number(open[1]);
    return start > 0 ? [start, Number.POSITIVE_INFINITY] : null;
  }
  const range = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return start > 0 && end >= start ? [start, end] : null;
  }
  const single = trimmed.match(/^(\d+)$/);
  if (single && Number(single[1]) > 0) {
    return [Number(single[1]), Number(single[1])];
  }
  return null;
}

function parseHighlightedLines(
  input: string | undefined,
  totalLines: number,
): Set<number> | undefined {
  if (!input) return undefined;
  const lines = new Set<number>();
  for (const part of input.split(",")) {
    const range = parseLineRange(part);
    if (!range) return undefined;
    const end = Math.min(range[1], totalLines);
    for (let line = range[0]; line <= end; line++) lines.add(line);
  }
  return lines.size ? lines : undefined;
}

function regionFromFile(
  file: DemoFile,
  lines?: string,
): Region | { warning: string } {
  // One trailing newline off, so line counts match what's shown.
  const content = file.content.replace(/\n$/, "");
  const all = content.split("\n");
  if (!lines?.trim()) {
    return { file: file.filename, code: content, language: file.language };
  }
  const range = parseLineRange(lines);
  if (!range) {
    return {
      warning: `Invalid lines="${lines}": expected "A-B", "A-" (start to end), or a single line "A".`,
    };
  }
  const [start, end] = range;
  if (start > all.length) {
    return {
      warning: `lines="${lines}" is out of range (the file has ${all.length} lines).`,
    };
  }
  if (Number.isFinite(end) && end > all.length) {
    console.warn(
      `[snippet] lines="${lines}" ends past ${file.filename} (${all.length} lines); clamping.`,
    );
  }
  return {
    file: file.filename,
    code: all.slice(start - 1, Math.min(end, all.length)).join("\n"),
    language: file.language,
  };
}

/** `page.snippet.tsx` captions as `page.tsx`. */
function captionFor(file: string): string {
  return (file.split("/").pop() ?? file).replace(/\.snippet(?=\.[^.]+$)/, "");
}

export async function Snippet({
  scope,
  region,
  file,
  lines,
  framework,
  cell,
  defaultFramework,
  defaultCell,
  noCaption,
  highlight,
}: SnippetProps & { scope: DocsScope }) {
  const resolvedFramework = framework ?? scope.framework ?? defaultFramework;
  const resolvedCell = cell ?? defaultCell;

  if (!region && !file) {
    return (
      <MissingSnippet>
        <code>&lt;Snippet /&gt;</code> needs either <code>region</code> or{" "}
        <code>file</code>: <code>region=&quot;my-region&quot;</code> for a
        tagged block, or <code>file=&quot;src/...&quot; lines=&quot;10-20&quot;</code>{" "}
        for a file.
      </MissingSnippet>
    );
  }

  if (!resolvedFramework) {
    return <Callout>Select an AI backend above to see this code example.</Callout>;
  }

  if (!resolvedCell) {
    return (
      <MissingSnippet>
        <code>
          {`<Snippet ${region ? `region="${region}"` : `file="${file}"`} />`}
        </code>{" "}
        has no cell (framework <code>{resolvedFramework}</code>). Pass{" "}
        <code>cell=&quot;...&quot;</code> or set <code>snippet_cell</code> in
        the page frontmatter.
      </MissingSnippet>
    );
  }

  const key = `${resolvedFramework}::${resolvedCell}`;
  const catalog = getCatalogCell(resolvedFramework, resolvedCell);
  if (catalog?.status === "unsupported") {
    return (
      <UnsupportedBox
        integrationName={catalog.integration_name ?? resolvedFramework}
        featureName={catalog.feature_name ?? resolvedCell}
      />
    );
  }

  const demo = getDemoRecord(resolvedFramework, resolvedCell);
  if (!demo) {
    return (
      <MissingSnippet>
        No demo found for <code>{key}</code>. Check the cell id and framework
        slug.
      </MissingSnippet>
    );
  }

  let found: Region;
  if (region) {
    const named = demo.regions?.[region];
    if (!named) {
      const available = Object.keys(demo.regions ?? {});
      return (
        <MissingSnippet>
          Region <code>{region}</code> not found in <code>{key}</code>. Tag the
          source lines with <code>{`// @region[${region}]`}</code> /{" "}
          <code>{`// @endregion[${region}]`}</code>.
          {available.length > 0 ? (
            <span className="mt-1 block text-xs">
              Available: {available.join(", ")}
            </span>
          ) : null}
        </MissingSnippet>
      );
    }
    found = named;
  } else {
    const demoFile = demo.files?.find((f) => f.filename === file);
    if (!demoFile) {
      const available = (demo.files ?? []).map((f) => f.filename);
      return (
        <MissingSnippet>
          File <code>{file}</code> isn&apos;t bundled in <code>{key}</code>.
          Check the path (relative to the cell root).
          {available.length > 0 ? (
            <span className="mt-1 block text-xs">
              Available: {available.slice(0, 6).join(", ")}
              {available.length > 6 ? ` (+${available.length - 6} more)` : ""}
            </span>
          ) : null}
        </MissingSnippet>
      );
    }
    const result = regionFromFile(demoFile, lines);
    if ("warning" in result) {
      return <MissingSnippet>{result.warning}</MissingSnippet>;
    }
    found = result;
  }

  if (typeof found.code !== "string") {
    return (
      <MissingSnippet>
        The snippet for <code>{key}</code> has no code; demo-content.json may
        be malformed or out of date.
      </MissingSnippet>
    );
  }

  return (
    <DocsCode
      code={found.code}
      lang={shikiLanguage(found.language)}
      title={noCaption ? undefined : captionFor(found.file)}
      highlightLines={parseHighlightedLines(
        highlight,
        found.code.split("\n").length,
      )}
    />
  );
}
