// Where a <Snippet>'s code and an <InlineDemo>'s demo come from, and what the
// page shows when there's none. Shared by the components (`snippet.tsx`,
// `inline-demo.tsx`) and the page's Markdown
// (`src/lib/llms/showcase-markdown.ts`), so both show the same code, or the
// same gap. No UI here: the Markdown routes import it.

import {
  getCatalogCell,
  getDemoRecord,
  getIntegration,
  getIntegrations,
  getRegistry,
  type DemoFile,
} from "../data";
import type { DocsScope } from "../scope";
import { liveFramework } from "@/lib/live-scope";

export interface SnippetSourceProps {
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
}

export type SnippetSource =
  | { kind: "code"; file: string; code: string; language: string }
  /** The page's own cell, which this framework lacks: `MissingDemoBanner` says so once. */
  | { kind: "hidden" }
  | { kind: "no-source" }
  | { kind: "no-framework" }
  | { kind: "no-cell"; framework: string }
  /** The catalog marks the demo not supported on this framework. */
  | { kind: "unsupported"; integrationName: string; featureName: string }
  /** Another framework has the cell; this one doesn't yet. */
  | { kind: "not-yet"; name: string; cell: string }
  | { kind: "no-demo"; key: string }
  | { kind: "no-region"; key: string; region: string; available: string[] }
  | { kind: "no-file"; key: string; file: string; available: string[] }
  | { kind: "bad-lines"; warning: string }
  | { kind: "no-code"; key: string };

/** The frameworks the site shows whose showcase has `cell`, in registry order. */
export function frameworksWithCell(cell: string): string[] {
  return getIntegrations()
    .map((i) => i.slug)
    .filter((slug) => liveFramework(slug) && getDemoRecord(slug, cell));
}

/**
 * Why a page's own cell has no code on this framework, or null when it has:
 * the catalog marks it unsupported, or the framework lacks the demo that
 * `others` have.
 */
export function missingDemo(
  framework: string,
  cell: string,
):
  | { kind: "unsupported"; integrationName: string; featureName: string }
  | { kind: "absent"; name: string; others: string[] }
  | null {
  const catalog = getCatalogCell(framework, cell);
  if (catalog?.status === "unsupported") {
    return {
      kind: "unsupported",
      integrationName:
        catalog.integration_name ??
        getIntegration(framework)?.name ??
        framework,
      featureName: catalog.feature_name ?? cell,
    };
  }
  if (getDemoRecord(framework, cell)) return null;
  const others = frameworksWithCell(cell);
  if (!others.length) return null;
  return {
    kind: "absent",
    name: getIntegration(framework)?.name ?? framework,
    others,
  };
}

/**
 * `"10-20"` or `"5"` to `[start, end]`, 1-based and inclusive; `"10-"` runs
 * to the end (`Infinity`, clamped by the caller). Empty means no range.
 */
export function parseLineRange(
  input: string | undefined,
): [number, number] | null {
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

function regionFromFile(
  file: DemoFile,
  lines?: string,
): { file: string; code: string; language: string } | { warning: string } {
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

/**
 * Resolve a `<Snippet>`. `region` wins over `file`. The framework is the
 * explicit `framework` prop, else the page's URL framework, else the page's
 * `snippet_framework` (`defaultFramework`); the cell is `cell`, else the
 * page's `snippet_cell` (`defaultCell`).
 */
export function resolveSnippet(
  {
    region,
    file,
    lines,
    framework,
    cell,
    defaultFramework,
    defaultCell,
  }: SnippetSourceProps,
  scope: DocsScope,
): SnippetSource {
  const resolvedFramework = framework ?? scope.framework ?? defaultFramework;
  const resolvedCell = cell ?? defaultCell;

  if (!region && !file) return { kind: "no-source" };
  if (!resolvedFramework) return { kind: "no-framework" };
  if (!resolvedCell) return { kind: "no-cell", framework: resolvedFramework };

  const key = `${resolvedFramework}::${resolvedCell}`;
  const ownCell = !cell || cell === defaultCell;
  const catalog = getCatalogCell(resolvedFramework, resolvedCell);
  if (catalog?.status === "unsupported") {
    // The page's own cell: `MissingDemoBanner` says so once at the top.
    if (scope.framework && ownCell) return { kind: "hidden" };
    return {
      kind: "unsupported",
      integrationName: catalog.integration_name ?? resolvedFramework,
      featureName: catalog.feature_name ?? resolvedCell,
    };
  }

  const demo = getDemoRecord(resolvedFramework, resolvedCell);
  // A cell another framework has is a gap in this framework's showcase, not
  // a typo. The page's own cell gets one banner at the top
  // (`MissingDemoBanner`), so its samples are left out; another cell says so
  // where its sample would be.
  if (!demo && frameworksWithCell(resolvedCell).length) {
    if (ownCell) return { kind: "hidden" };
    return {
      kind: "not-yet",
      name: getIntegration(resolvedFramework)?.name ?? resolvedFramework,
      cell: resolvedCell,
    };
  }
  if (!demo) return { kind: "no-demo", key };

  let found: { file: string; code: string; language: string };
  if (region) {
    const named = demo.regions?.[region];
    if (!named) {
      return {
        kind: "no-region",
        key,
        region,
        available: Object.keys(demo.regions ?? {}),
      };
    }
    found = named;
  } else {
    const demoFile = demo.files?.find((f) => f.filename === file);
    if (!demoFile) {
      return {
        kind: "no-file",
        key,
        file: file!,
        available: (demo.files ?? []).map((f) => f.filename),
      };
    }
    const result = regionFromFile(demoFile, lines);
    if ("warning" in result) {
      return { kind: "bad-lines", warning: result.warning };
    }
    found = result;
  }

  if (typeof found.code !== "string") return { kind: "no-code", key };
  return {
    kind: "code",
    file: found.file,
    code: found.code,
    language: found.language,
  };
}

/** A showcase file as readers name it: `page.snippet.tsx` is `page.tsx`. */
export function snippetFileName(file: string): string {
  return file.replace(/\.snippet(?=\.[^.]+$)/, "");
}

/**
 * The deployed showcase demo an `<InlineDemo>` embeds, or why it embeds
 * nothing.
 */
export function inlineDemoTarget(
  {
    integration,
    demo,
    defaultFramework,
  }: { integration?: string; demo?: string; defaultFramework?: string },
  scope: DocsScope,
) {
  const slug = scope.framework ?? defaultFramework ?? integration;
  if (!slug || !demo) {
    return { empty: `missing props (integration=${slug}, demo=${demo})` };
  }
  const int = getRegistry().integrations.find((i) => i.slug === slug);
  if (!int || !int.deployed) {
    return {
      empty: int
        ? `"${slug}" is not deployed`
        : `no integration "${slug}" in the registry`,
    };
  }
  const catalog = getCatalogCell(slug, demo);
  // A demo the framework can't run yet stays out of the page. When it's the
  // page's own demo, `MissingDemoBanner` says so once at the top.
  // An expected state, so no warning (`empty: null`).
  if (catalog?.status === "unsupported") return { empty: null };

  const entry = int.demos.find((d) => d.id === demo);
  // Not in this framework's showcase: a frame would load a 404. The page's
  // `MissingDemoBanner` says so instead.
  if (!entry && !getDemoRecord(slug, demo)) {
    return { empty: `"${slug}" has no "${demo}" demo` };
  }
  return { slug, demo, int, entry };
}
