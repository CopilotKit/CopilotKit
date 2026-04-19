// Bundle Demo Content
//
// Reads demo source files and READMEs from all integration packages
// and produces a JSON bundle for the shell's Code and Docs tabs.
//
// Usage: npx tsx showcase/scripts/bundle-demo-content.ts
//
// -----------------------------------------------------------------------------
// Named-region markers (inline, Option A)
// -----------------------------------------------------------------------------
// Authors can tag contiguous spans of a source file with a name so the shell's
// docs pages can pull in a specific snippet without hardcoding line numbers.
//
// Syntax (recognised in any comment style — // or # or <!-- -->):
//
//     // @region[provider-setup]
//     ... lines belonging to the region ...
//     // @endregion[provider-setup]
//
// Rules:
//  - Regions may nest (e.g. `@region[outer]` can contain `@region[inner]`).
//  - Region names must be `[a-z0-9][a-z0-9-]*`; any marker with a malformed
//    name is left untouched and the bundler errors out.
//  - When the same region name appears in multiple files inside a cell, the
//    bundler concatenates their bodies in the stable file order. This makes
//    a "multi-file region" a natural consequence of marker placement rather
//    than special syntax.
//  - The markers themselves are stripped from the bundled file content so the
//    `/code` viewer doesn't show them. The stripped content is what's stored
//    in `files[].content`; the original region bodies are stored separately
//    in `regions[<name>]`.
//  - Start/end line numbers reflect post-strip positions (i.e. the line
//    numbers an MDX page would show if it rendered the cleaned file).
// -----------------------------------------------------------------------------

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "packages");
const OUTPUT_PATH = path.join(
  ROOT,
  "shell",
  "src",
  "data",
  "demo-content.json",
);

interface DemoFile {
  filename: string;
  language: string;
  content: string;
  highlighted?: boolean;
}

interface Region {
  /** Source file (relative to the demo root) the region was extracted from. */
  file: string;
  /** 1-based line number of the first line inside the region (post strip). */
  startLine: number;
  /** 1-based inclusive line number of the last line inside the region. */
  endLine: number;
  /** The region's code, markers stripped. */
  code: string;
  /** Highlight-friendly language hint, propagated from the file extension. */
  language: string;
}

interface DemoContent {
  readme: string | null;
  files: DemoFile[];
  // Retained for JSON shape back-compat; always empty under the new rule
  // that `/code` shows only the demo folder's actual contents.
  backend_files: DemoFile[];
  /**
   * Named regions extracted from `// @region[name] … // @endregion[name]`
   * markers inside the cell's source files. Keyed by region name.
   * Multi-file regions (same name in multiple files) are concatenated in
   * the same stable order as `files`.
   */
  regions: Record<string, Region>;
}

interface BundledContent {
  generated_at: string;
  demos: Record<string, DemoContent>; // key: "integration-slug::demo-id"
}

function detectLanguage(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".tsx": "typescript",
    ".ts": "typescript",
    ".jsx": "javascript",
    ".js": "javascript",
    ".py": "python",
    ".cs": "csharp",
    ".css": "css",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".mdx": "markdown",
  };
  return map[ext] || "text";
}

// Skip generated/OS noise. Everything else in the demo folder is shown.
const SKIP_EXACT = new Set([".DS_Store", "Thumbs.db"]);
const SKIP_DIRS = new Set(["__pycache__", "node_modules", ".next"]);

// ---------------------------------------------------------------------------
// Region extraction
// ---------------------------------------------------------------------------

/**
 * Matches a start marker in any line-comment flavour:
 *   `// @region[name]`      (JS/TS/Java/C#)
 *   `# @region[name]`       (Python/YAML/Bash)
 *   `<!-- @region[name] -->`  (HTML/MDX)  — only `@region[name]` token matters
 *   `/* @region[name] *\/`  (C-style block)
 *
 * We don't mandate a prefix because anything before `@region[` is noise:
 * comment tokens, whitespace, etc. The whole line is dropped on strip.
 */
const REGION_START_RE = /@region\[([a-z0-9][a-z0-9-]*)\]/;
const REGION_END_RE = /@endregion\[([a-z0-9][a-z0-9-]*)\]/;

/**
 * A loose detector for ANY `@region[...]` or `@endregion[...]` marker,
 * including malformed names. We use this to reject bad syntax early instead
 * of silently leaving a stray marker in the bundled output.
 */
const REGION_ANY_RE = /@(?:end)?region\[[^\]]*\]/;

interface ExtractedRegion {
  startLine: number; // 1-based, post-strip
  endLine: number; // 1-based, post-strip, inclusive
  lines: string[];
}

/**
 * Strip region markers from a file and return:
 *  - `cleaned`: the file contents with all marker lines removed
 *  - `regions`: a map of region name → extracted slice(s) of `cleaned`
 *
 * Nested regions are supported. A region whose start has no matching end
 * (or vice-versa) throws — bundling should fail loudly rather than produce
 * a silently-broken snippet.
 */
function extractRegions(
  source: string,
  fileLabel: string,
): { cleaned: string; regions: Record<string, ExtractedRegion[]> } {
  const srcLines = source.split("\n");
  const cleaned: string[] = [];
  // Stack of active regions: name → start line (1-based index into cleaned).
  const stack: Array<{ name: string; startLine: number }> = [];
  const regions: Record<string, ExtractedRegion[]> = {};
  // While a region is open we accumulate its body lines here (indexed by
  // position in `stack` so nested regions each get their own buffer).
  const buffers: string[][] = [];

  for (const rawLine of srcLines) {
    const startMatch = rawLine.match(REGION_START_RE);
    const endMatch = rawLine.match(REGION_END_RE);

    if (startMatch && endMatch) {
      throw new Error(
        `${fileLabel}: same line contains both @region and @endregion — that's not supported.`,
      );
    }

    if (startMatch) {
      const name = startMatch[1];
      stack.push({ name, startLine: cleaned.length + 1 });
      buffers.push([]);
      continue;
    }

    if (endMatch) {
      const name = endMatch[1];
      const top = stack.pop();
      const buf = buffers.pop();
      if (!top || !buf) {
        throw new Error(
          `${fileLabel}: @endregion[${name}] without a matching @region[...].`,
        );
      }
      if (top.name !== name) {
        throw new Error(
          `${fileLabel}: @endregion[${name}] does not match innermost open region @region[${top.name}].`,
        );
      }
      const startLine = top.startLine;
      const endLine = cleaned.length; // last line pushed into `cleaned`
      if (endLine < startLine) {
        // Empty region — still record, but as a zero-line span.
        (regions[name] ||= []).push({
          startLine,
          endLine: startLine - 1,
          lines: [],
        });
      } else {
        (regions[name] ||= []).push({ startLine, endLine, lines: buf });
      }
      continue;
    }

    // Reject any stray, malformed marker that didn't match the strict regex.
    if (REGION_ANY_RE.test(rawLine)) {
      throw new Error(
        `${fileLabel}: malformed region marker "${rawLine.trim()}". Use @region[kebab-case-name] / @endregion[kebab-case-name].`,
      );
    }

    cleaned.push(rawLine);
    // Push this line into every currently-open region buffer.
    for (const buf of buffers) buf.push(rawLine);
  }

  if (stack.length > 0) {
    const unclosed = stack.map((s) => s.name).join(", ");
    throw new Error(`${fileLabel}: unclosed @region[${unclosed}].`);
  }

  return { cleaned: cleaned.join("\n"), regions };
}

function collectDemoFiles(
  demoDir: string,
  demoKey: string,
): {
  readme: string | null;
  files: DemoFile[];
  regions: Record<string, Region>;
} {
  const out: DemoFile[] = [];
  let readme: string | null = null;
  // Raw per-file region extractions, keyed by file path. We collapse them
  // into the public `regions` map (one entry per name) after sorting files
  // into their final display order, so multi-file regions concatenate in
  // the same order as the `/code` viewer lists them.
  const perFile: Record<string, Record<string, ExtractedRegion[]>> = {};

  const walk = (absDir: string, relPrefix: string) => {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_EXACT.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const raw = fs.readFileSync(abs, "utf-8");
      // Extract & strip region markers before anything else sees the text.
      // This keeps the /code viewer clean and lets docs reference specific
      // named slices. A bad marker aborts the whole bundle.
      const { cleaned, regions: fileRegions } = extractRegions(
        raw,
        `${demoKey}:${rel}`,
      );
      if (entry.name === "README.md" || entry.name === "README.mdx") {
        // Use the root-level README as the demo readme; nested README files
        // just show up as regular files.
        if (!relPrefix && readme === null) {
          readme = cleaned;
          if (Object.keys(fileRegions).length > 0) {
            perFile[rel] = fileRegions;
          }
          continue;
        }
      }
      out.push({
        filename: rel,
        language: detectLanguage(entry.name),
        content: cleaned,
      });
      if (Object.keys(fileRegions).length > 0) {
        perFile[rel] = fileRegions;
      }
    }
  };

  walk(demoDir, "");

  // Stable, friendly order: page first, then everything else lexicographic.
  out.sort((a, b) => {
    const aPage = a.filename.startsWith("page.");
    const bPage = b.filename.startsWith("page.");
    if (aPage !== bPage) return aPage ? -1 : 1;
    return a.filename.localeCompare(b.filename);
  });

  // Collapse per-file regions into the public map in file-order. For
  // multi-file regions we concatenate bodies with a blank separator and
  // use the FIRST file's line span (there's no single coherent range
  // across files — this is a best-effort pointer for tooling).
  const regions: Record<string, Region> = {};
  const fileOrder = out.map((f) => f.filename);
  for (const filename of fileOrder) {
    const fileRegs = perFile[filename];
    if (!fileRegs) continue;
    for (const [name, slices] of Object.entries(fileRegs)) {
      for (const slice of slices) {
        if (regions[name]) {
          // Multi-file or duplicate region — append with separator.
          regions[name].code =
            regions[name].code + "\n\n" + slice.lines.join("\n");
        } else {
          regions[name] = {
            file: filename,
            startLine: slice.startLine,
            endLine: slice.endLine,
            code: slice.lines.join("\n"),
            language: detectLanguage(filename),
          };
        }
      }
    }
  }

  return { readme, files: out, regions };
}

function main() {
  console.log("Bundling demo content...\n");

  const bundle: BundledContent = {
    generated_at: new Date().toISOString(),
    demos: {},
  };

  if (!fs.existsSync(PACKAGES_DIR)) {
    console.log("No packages directory found.");
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + "\n");
    return;
  }

  const packageDirs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const pkgDir of packageDirs) {
    try {
      const manifestPath = path.join(PACKAGES_DIR, pkgDir, "manifest.yaml");
      if (!fs.existsSync(manifestPath)) continue;

      const manifest = yaml.parse(fs.readFileSync(manifestPath, "utf-8"));
      const slug = manifest.slug as string;
      const demos = (manifest.demos || []) as Array<{
        id: string;
        route: string;
        highlight?: string[];
      }>;

      for (const demo of demos) {
        // Informational-only demos (e.g. cli-start) have no route/folder.
        if (!demo.route) continue;
        // Prefer the per-cell folder (packages/<pkg>/demos/<id>/) if it
        // exists — that's the target layout where each demo is a fully
        // independent container. Fall back to the in-integration folder
        // (packages/<pkg>/src/app/demos/<routeDir>/) for un-migrated demos.
        const routeDir = demo.route.replace(/^\/demos\//, "");
        const cellDir = path.join(PACKAGES_DIR, pkgDir, "demos", demo.id);
        const legacyDir = path.join(
          PACKAGES_DIR,
          pkgDir,
          "src",
          "app",
          "demos",
          routeDir,
        );
        const demoDir = fs.existsSync(cellDir) ? cellDir : legacyDir;
        if (!fs.existsSync(demoDir)) {
          throw new Error(
            `${slug}::${demo.id}: neither ${cellDir} nor ${legacyDir} exists.`,
          );
        }

        const key = `${slug}::${demo.id}`;
        const { readme, files, regions } = collectDemoFiles(demoDir, key);

        // Apply `highlight` from the manifest: mark listed files as
        // relevant. Error if a listed path doesn't exist in the bundle —
        // highlighting a ghost file would silently mislead readers.
        const highlightSet = new Set(demo.highlight ?? []);
        if (highlightSet.size > 0) {
          const bundled = new Set(files.map((f) => f.filename));
          for (const h of highlightSet) {
            if (!bundled.has(h)) {
              throw new Error(
                `${key}: manifest.highlight lists "${h}" but that file isn't in the demo folder.`,
              );
            }
          }
          for (const f of files) {
            if (highlightSet.has(f.filename)) f.highlighted = true;
          }
        }

        bundle.demos[key] = { readme, files, backend_files: [], regions };
        const hlCount = files.filter((f) => f.highlighted).length;
        const regionCount = Object.keys(regions).length;
        console.log(
          `  ${key}: ${files.length} files${hlCount ? ` (${hlCount} highlighted)` : ""}${readme ? " + README" : ""}${regionCount ? ` + ${regionCount} regions` : ""}`,
        );
      }
    } catch (err) {
      // Propagate: a broken manifest must fail the bundle, not silently skip.
      throw new Error(
        `[bundle] Failed while processing package "${pkgDir}": ${(err as Error).message}`,
      );
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + "\n");
  console.log(
    `\nBundled ${Object.keys(bundle.demos).length} demos to ${OUTPUT_PATH}\n`,
  );
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

if (process.argv.includes("--watch")) {
  let timer: NodeJS.Timeout | null = null;
  const rebundle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        main();
      } catch (e) {
        console.error("[watch] bundle failed:", e);
      }
    }, 200);
  };
  console.log("[watch] watching packages/ for changes...\n");
  fs.watch(PACKAGES_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Rebundle for demo sources, agent sources, READMEs, and — critically —
    // manifest.yaml edits. Without the manifest match a demo's backend_files
    // change wouldn't propagate and /code would keep showing stale files.
    if (
      /(\/demos\/|\/agents\/|\/agent\/|\/mastra\/|README\.md$|manifest\.yaml$)/.test(
        filename,
      )
    ) {
      rebundle();
    }
  });
}
