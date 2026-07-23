// Pure source-rewrite pass for `<DemoCode>` references in a concept
// file. Lives in its own file (no JSX) so test code can import it
// without pulling the React component shim through the test graph.
// See setup-concept.tsx for the orchestrator that drives this pass.

import fs from "fs";
import path from "path";
import { extractRegion, inferLanguage } from "./demo-code";
import { resolveWithinDir } from "./safe-fs";

/**
 * Match the value of a string-literal JSX attribute. Returns undefined
 * for expression-valued attrs (e.g. `file={x}`) so the rewrite pass can
 * leave those references intact for the runtime component shim.
 */
function matchAttr(attrs: string, name: string): string | undefined {
  const dq = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  if (dq) return dq[1];
  const sq = new RegExp(`\\b${name}='([^']*)'`).exec(attrs);
  if (sq) return sq[1];
  return undefined;
}

/**
 * Pre-expand `<DemoCode file="..." region="..." [language="..."] [title="..."] />`
 * JSX references in a concept-file source into fenced markdown blocks
 * sourced from `packageRoot`. The rewritten fences flow through the
 * regular MDXRemote → rehypeCode pipeline so they pick up Shiki
 * highlighting + the MdxCodeBlock chrome (copy button + figcaption).
 *
 * Only string-literal props are handled here. References with
 * expression-valued props (e.g. `file={something}`) are left intact
 * for the runtime component shim to resolve. Same posture as
 * `inlineSnippets` in docs-render.tsx.
 *
 * A reference whose file or region can't be found is replaced with an
 * empty string (logged to the server console). The body shouldn't
 * silently surface a broken `<DemoCode>` JSX tag — that would crash
 * the MDX compile.
 */
export interface RewriteDemoCodeOptions {
  onError?: "warn" | "throw";
}

function handleRewriteError(
  message: string,
  options: RewriteDemoCodeOptions,
): string {
  if (options.onError === "throw") {
    throw new Error(message);
  }
  console.warn(message);
  return "";
}

function formatFenceTitle(title: string): string {
  return JSON.stringify(title);
}

const DEMO_CODE_TAG_RX = /<DemoCode\b((?:"[^"]*"|'[^']*'|[^'"<>])*)\/>/g;

function parseLineRange(input: string): [number, number] | null {
  const trimmed = input.trim();
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

function notationComment(language: string): string {
  return ["bash", "sh", "python", "py", "yaml", "yml"].includes(language)
    ? "#"
    : "//";
}

function applyHighlightMarkers(
  body: string,
  language: string,
  highlight: string | undefined,
): string {
  if (!highlight) return body;
  const lines = body.split("\n");
  const ranges: Array<[number, number]> = [];
  for (const part of highlight.split(",")) {
    const range = parseLineRange(part);
    if (!range) return body;
    const [start, end] = range;
    const effectiveEnd = Math.min(
      end === Number.POSITIVE_INFINITY ? lines.length : end,
      lines.length,
    );
    if (start <= effectiveEnd) ranges.push([start, effectiveEnd]);
  }
  if (ranges.length === 0) return body;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  const marker = notationComment(language);
  let offset = 0;
  for (const [start, end] of merged) {
    const count = end - start + 1;
    lines.splice(start - 1 + offset, 0, `${marker} [!code highlight:${count}]`);
    offset++;
  }
  return lines.join("\n");
}

export function rewriteDemoCode(
  source: string,
  packageRoot: string,
  options: RewriteDemoCodeOptions = {},
): string {
  // Match `<DemoCode ... />` with quoted attributes, including values
  // such as `title="A > B"`, without spanning into the next JSX tag.
  return source.replace(DEMO_CODE_TAG_RX, (match, attrs: string) => {
    const file = matchAttr(attrs, "file");
    const region = matchAttr(attrs, "region");
    if (!file || !region) {
      if (options.onError === "throw") {
        throw new Error(
          `[demo-code] DemoCode references must use static file and region props: ${match}`,
        );
      }
      return match;
    }

    const language = matchAttr(attrs, "language");
    const title = matchAttr(attrs, "title");
    const highlight = matchAttr(attrs, "highlight");

    const resolved = resolveWithinDir(packageRoot, file);
    if (!resolved || !fs.existsSync(resolved)) {
      return handleRewriteError(
        `[demo-code] file not found ${file} in package root ${packageRoot}`,
        options,
      );
    }
    let raw: string;
    try {
      raw = fs.readFileSync(resolved, "utf-8");
    } catch (err) {
      return handleRewriteError(
        `[demo-code] failed to read ${resolved}: ${(err as Error).message}`,
        options,
      );
    }
    const ext = file.includes(".")
      ? file.slice(file.lastIndexOf(".") + 1).toLowerCase()
      : "";
    let body: string | null;
    try {
      body = extractRegion(raw, region, ext);
    } catch (err) {
      return handleRewriteError(
        `[demo-code] extraction failed ${file} ${region}: ${(err as Error).message}`,
        options,
      );
    }
    if (body === null) {
      return handleRewriteError(
        `[demo-code] region not found ${region} in ${file}`,
        options,
      );
    }
    const lang = language ?? inferLanguage(file);
    const fenceTitle = title ?? path.basename(file);
    const highlightedBody = applyHighlightMarkers(body, lang, highlight);
    // 4-tilde fence so the embedded body can safely contain triple
    // backticks without prematurely closing the fence.
    return [
      "",
      `~~~~${lang} title=${formatFenceTitle(fenceTitle)}`,
      highlightedBody,
      "~~~~",
      "",
    ].join("\n");
  });
}
