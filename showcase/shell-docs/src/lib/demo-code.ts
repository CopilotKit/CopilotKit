// Pure region extractor + language dispatch for <DemoCode>.
//
// Concept files (showcase/integrations/<slug>/docs/setup/*.mdx) embed
// `<DemoCode file="..." region="..." />` to pull live source from the
// integration package. The orchestrator (setup-concept.tsx) rewrites
// these references into fenced markdown blocks BEFORE MDXRemote
// compiles the concept file, so the fences flow through the existing
// Shiki / MdxCodeBlock pipeline and pick up syntax highlighting for
// free. This module owns the pure extraction logic + language table
// only; the defensive React component shim lives next to the
// orchestrator (setup-concept.tsx) where it's used.

// Re-read on every call so vitest can flip NODE_ENV between dev and
// prod within a single test file (the dup-region tests depend on this).
const isDev = (): boolean => process.env.NODE_ENV !== "production";

// Comment syntax dispatched by file extension (without the dot). Two
// kinds today — Python-style `#` and C-style `//`. Add new languages
// here as integrations need them.
const COMMENT_BY_EXT: Record<string, "py" | "slash"> = {
  py: "py",
  ts: "slash",
  tsx: "slash",
  js: "slash",
  jsx: "slash",
  java: "slash",
  cs: "slash",
  go: "slash",
  kt: "slash",
  rs: "slash",
};

// Language label for Shiki / rehype-code. Falls back to "plaintext"
// when the extension isn't in the table — authors override via the
// `language` prop when they need something exotic.
const LANG_BY_EXT: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  java: "java",
  cs: "csharp",
  go: "go",
  kt: "kotlin",
  rs: "rust",
};

export function inferLanguage(filePath: string): string {
  const ext = filePath.includes(".")
    ? filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase()
    : "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}

// Build the region-start and region-end matchers for a given extension.
// Markers are matched against the line with leading whitespace tolerated
// (common in indented class bodies). Returns null when the extension
// has no comment syntax registered — callers treat that as "can't
// extract" and return null upstream.
function markersFor(ext: string): {
  start: (region: string) => RegExp;
  end: RegExp;
} | null {
  const kind = COMMENT_BY_EXT[ext];
  if (!kind) return null;
  const prefix = kind === "py" ? "#" : "//";
  return {
    start: (region) =>
      new RegExp(
        `^\\s*${prefix}\\s*region:\\s*${region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
      ),
    end: new RegExp(`^\\s*${prefix}\\s*endregion\\b`),
  };
}

/**
 * Extract the body of `# region: <name>` ... `# endregion` (Python) /
 * `// region: <name>` ... `// endregion` (TS/JS/etc.) from a source
 * string. Markers are stripped from the returned content.
 *
 * @param source raw file contents
 * @param region region name
 * @param ext file extension (without the leading dot), used to pick comment syntax
 *
 * Returns null when the region is not found, or when `ext` has no
 * comment syntax registered.
 *
 * Throws when the region starts but is never terminated by an
 * `endregion` (in both dev and prod — emitting an unbounded region
 * would dump the rest of the file).
 *
 * Throws in dev mode when the same region name appears multiple times
 * in the source — the author should fix one of them. In prod, those
 * blocks are concatenated in source order so a render never breaks
 * over an authoring slip in package source.
 */
export function extractRegion(
  source: string,
  region: string,
  ext: string,
): string | null {
  const markers = markersFor(ext);
  if (!markers) return null;
  const lines = source.split("\n");
  const startRx = markers.start(region);
  const endRx = markers.end;

  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!startRx.test(lines[i])) {
      i++;
      continue;
    }
    const startIdx = i;
    let endIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (endRx.test(lines[j])) {
        endIdx = j;
        break;
      }
    }
    if (endIdx === -1) {
      throw new Error(
        `[demo-code] unterminated region "${region}" starting at line ${startIdx + 1}`,
      );
    }
    blocks.push(lines.slice(startIdx + 1, endIdx).join("\n"));
    i = endIdx + 1;
  }

  if (blocks.length === 0) return null;
  if (blocks.length > 1) {
    if (isDev()) {
      throw new Error(
        `[demo-code] duplicate region "${region}" appears ${blocks.length} times — fix the source`,
      );
    }
    return blocks.join("\n");
  }
  return blocks[0];
}
