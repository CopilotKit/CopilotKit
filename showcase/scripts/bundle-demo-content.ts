// Bundle Demo Content
//
// Reads demo source files from all integration packages and produces a JSON
// bundle for the shell's Code tab. The resulting shape is flat:
//
//   demos: Record<"<slug>::<demo-id>", {
//     readme: string | null,
//     files: { filename, language, content, highlighted? }[],
//     backend_files: [],               // retained for shape back-compat
//     regions: Record<name, Region>,
//   }>
//
// Files are scanned from the demo folder (`src/app/demos/<routeDir>/`)
// recursively, and any files listed in the manifest's `highlight:` field
// that sit OUTSIDE the demo folder (typically `src/agents/<agent>.py`) are
// merged in with their column-relative paths.
//
// Every path in `highlight:` must point to a real bundled file — otherwise
// the bundle fails. This keeps stale references from silently rotting.
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
// demo-content is consumed by BOTH shells:
//   - shell: integration pages + demo drawer read the bundle at runtime
//   - shell-docs: <Snippet> (docs routes) imports directly at build time
// so we dual-emit. Paths array is iterated at write time.
const OUTPUT_PATHS = [
  path.join(ROOT, "shell", "src", "data", "demo-content.json"),
  path.join(ROOT, "shell-docs", "src", "data", "demo-content.json"),
];

interface DemoFile {
  filename: string;
  language: string;
  content: string;
  highlighted?: boolean;
}

interface Region {
  /** Source file (relative to the demo root / column root for externals). */
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
  // that `/code` shows only the demo folder's actual contents + external
  // highlights.
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

// Skip generated / OS noise when walking demo folders.
const SKIP_EXACT = new Set([".DS_Store", "Thumbs.db"]);
const SKIP_DIRS = new Set(["__pycache__", "node_modules", ".next"]);
// Extensions to skip entirely. Includes compiled Python artefacts (.pyc) and
// binary-like assets we should NEVER pass through `fs.readFileSync(..., "utf-8")`
// — doing so mangles the bytes and injects garbage strings into the bundled
// `demo-content.json`. Images, fonts, archives, and PDFs all belong here.
const SKIP_EXTENSIONS = new Set([
  ".pyc",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".avif",
  ".tiff",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  // Documents / archives
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".7z",
  ".rar",
  // Media
  ".mp4",
  ".mp3",
  ".wav",
  ".mov",
  ".webm",
  ".ogg",
]);

// ---------------------------------------------------------------------------
// Region extraction
// ---------------------------------------------------------------------------

/**
 * Matches a start marker in any line-comment flavour:
 *   `// @region[name]`      (JS/TS/Java/C#)
 *   `# @region[name]`       (Python/YAML/Bash)
 *   `<!-- @region[name] -->`  (HTML/MDX)  — only `@region[name]` token matters
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
  relPrefix: string,
  demoKey: string,
): {
  readme: string | null;
  files: DemoFile[];
  perFileRegions: Record<string, Record<string, ExtractedRegion[]>>;
} {
  const out: DemoFile[] = [];
  let readme: string | null = null;
  const perFileRegions: Record<string, Record<string, ExtractedRegion[]>> = {};

  const walk = (absDir: string, currentRel: string) => {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_EXACT.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const raw = fs.readFileSync(abs, "utf-8");
      // Extract & strip region markers before anything else sees the text.
      const { cleaned, regions: fileRegions } = extractRegions(
        raw,
        `${demoKey}:${rel}`,
      );
      const bundledPath = relPrefix ? `${relPrefix}/${rel}` : rel;
      if (entry.name === "README.md" || entry.name === "README.mdx") {
        // Use the demo-dir root README as the readme; nested READMEs show
        // up as regular files.
        if (!currentRel && readme === null) {
          readme = cleaned;
          if (Object.keys(fileRegions).length > 0) {
            perFileRegions[bundledPath] = fileRegions;
          }
          continue;
        }
      }
      out.push({
        filename: bundledPath,
        language: detectLanguage(entry.name),
        content: cleaned,
      });
      if (Object.keys(fileRegions).length > 0) {
        perFileRegions[bundledPath] = fileRegions;
      }
    }
  };

  walk(demoDir, "");

  return { readme, files: out, perFileRegions };
}

function main() {
  console.log("Bundling demo content...\n");

  const bundle: BundledContent = {
    generated_at: new Date().toISOString(),
    demos: {},
  };

  if (!fs.existsSync(PACKAGES_DIR)) {
    console.log("No packages directory found.");
    const json = JSON.stringify(bundle, null, 2) + "\n";
    for (const outputPath of OUTPUT_PATHS) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, json);
    }
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
        route?: string;
        command?: string;
        highlight?: string[];
      }>;

      const pkgRoot = path.join(PACKAGES_DIR, pkgDir);

      for (const demo of demos) {
        // Informational-only demos (e.g. cli-start with a `command:` field)
        // have no route/folder. Skip them — nothing to bundle.
        if (!demo.route) continue;

        const routeDir = demo.route.replace(/^\/demos\//, "");
        const demoDir = path.join(pkgRoot, "src", "app", "demos", routeDir);
        if (!fs.existsSync(demoDir)) {
          throw new Error(
            `${slug}::${demo.id}: demo folder does not exist at ${demoDir}.`,
          );
        }

        const key = `${slug}::${demo.id}`;

        // 1. Collect the demo folder's contents.
        //    The bundled `filename` for each is prefixed with the
        //    column-relative path so highlight: entries can be matched as
        //    full column-relative paths.
        const demoRelPrefix = `src/app/demos/${routeDir}`;
        const { readme, files, perFileRegions } = collectDemoFiles(
          demoDir,
          demoRelPrefix,
          key,
        );

        // 2. Pull in any highlight: entries that sit OUTSIDE the demo folder
        //    (typically backend agents under src/agents/*). Error if a
        //    highlight path doesn't resolve to a real file.
        const highlightList = demo.highlight ?? [];
        const demoPathSet = new Set(files.map((f) => f.filename));
        for (const hlPath of highlightList) {
          if (demoPathSet.has(hlPath)) continue;
          const absExternal = path.resolve(pkgRoot, hlPath);
          // Guard against highlight entries that escape the package root
          // (e.g. `../../other-pkg/secret.txt` or absolute paths). The
          // bundle output is committed to the repo and consumed by both
          // shells at build time, so a malicious manifest could otherwise
          // smuggle arbitrary filesystem contents into the bundled JSON.
          // Block anything that resolves outside pkgRoot up front.
          const rel = path.relative(pkgRoot, absExternal);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(
              `${key}: highlight path "${hlPath}" resolves outside the package root (${absExternal}). Highlight paths must be package-relative.`,
            );
          }
          if (!fs.existsSync(absExternal)) {
            throw new Error(
              `${key}: highlight path "${hlPath}" not found in demo folder nor at ${absExternal}.`,
            );
          }
          if (!fs.statSync(absExternal).isFile()) {
            throw new Error(
              `${key}: highlight path "${hlPath}" exists but is not a regular file.`,
            );
          }
          const raw = fs.readFileSync(absExternal, "utf-8");
          const { cleaned, regions: fileRegions } = extractRegions(
            raw,
            `${key}:${hlPath}`,
          );
          files.push({
            filename: hlPath,
            language: detectLanguage(hlPath),
            content: cleaned,
          });
          if (Object.keys(fileRegions).length > 0) {
            perFileRegions[hlPath] = fileRegions;
          }
        }

        // 3. Apply highlights. All `highlight:` entries must now resolve to
        //    bundled files (the step above guarantees that for external
        //    files; for files inside the demo folder we check here).
        const highlightSet = new Set(highlightList);
        const bundled = new Set(files.map((f) => f.filename));
        for (const h of highlightSet) {
          if (!bundled.has(h)) {
            throw new Error(
              `${key}: manifest.highlight lists "${h}" but that file isn't in the bundle.`,
            );
          }
        }
        for (const f of files) {
          if (highlightSet.has(f.filename)) f.highlighted = true;
        }

        // Stable order: page.* first, then everything else alphabetical.
        files.sort((a, b) => {
          const aIsPage = /(^|\/)page\.[tj]sx?$/.test(a.filename);
          const bIsPage = /(^|\/)page\.[tj]sx?$/.test(b.filename);
          if (aIsPage !== bIsPage) return aIsPage ? -1 : 1;
          return a.filename.localeCompare(b.filename);
        });

        // Collapse per-file regions into the public map in file-order. For
        // multi-file regions we concatenate bodies with a blank separator.
        //
        // Caption accuracy: when the SAME region name appears in multiple
        // files we previously kept the first file's `file`/`startLine`/
        // `endLine` while appending code from subsequent files — the rendered
        // `<Snippet>` caption then read like a single-file slice but showed
        // concatenated content. Instead we track contributor filenames and,
        // when >1, rewrite `file` to `(multiple: a, b)` so the caption
        // visibly signals the concatenation. `startLine`/`endLine` are
        // preserved (Snippet's caption always renders a line range and
        // rewriting those to null would break the renderer) — they remain
        // the FIRST contributor's span as a best-effort pointer, with the
        // `(multiple: ...)` prefix preventing the caption from misleading.
        //
        // `perFileRegions` can carry entries whose filename is NOT in
        // `files` — specifically the demo-root README (README.md / README.mdx),
        // which `collectDemoFiles` pulls out into the `readme` field rather
        // than appending to `files`. Iterating only `fileOrder` would drop
        // those regions silently. Build the effective order as: files (stable)
        // first, then any leftover perFileRegions keys (typically README) in
        // lexical order so multi-file regions prefer the demo source's span
        // over the README's — README regions either fill in untouched names
        // or get concatenated at the tail like any other contributor.
        const regions: Record<string, Region> = {};
        const regionContributors: Record<string, string[]> = {};
        const fileOrder = files.map((f) => f.filename);
        const knownInFiles = new Set(fileOrder);
        const leftoverKeys = Object.keys(perFileRegions)
          .filter((k) => !knownInFiles.has(k))
          .sort();
        const effectiveOrder = [...fileOrder, ...leftoverKeys];
        for (const filename of effectiveOrder) {
          const fileRegs = perFileRegions[filename];
          if (!fileRegs) continue;
          for (const [name, slices] of Object.entries(fileRegs)) {
            for (const slice of slices) {
              if (regions[name]) {
                regions[name].code =
                  regions[name].code + "\n\n" + slice.lines.join("\n");
                // Same-file multi-slice: extend endLine so the caption's
                // span at least reaches the last contributor in the
                // original file. Cross-file concatenation keeps the first
                // contributor's span untouched (file gets rewritten to
                // `(multiple: …)` below, which signals the caption can't
                // be a single contiguous range).
                if (regions[name].file === filename) {
                  regions[name].endLine = slice.endLine;
                }
                if (!regionContributors[name].includes(filename)) {
                  regionContributors[name].push(filename);
                }
              } else {
                regions[name] = {
                  file: filename,
                  startLine: slice.startLine,
                  endLine: slice.endLine,
                  code: slice.lines.join("\n"),
                  language: detectLanguage(filename),
                };
                regionContributors[name] = [filename];
              }
            }
          }
        }
        // Rewrite `file` for regions with >1 contributor so the snippet
        // caption visibly signals concatenation instead of lying about
        // origin. Keep the first contributor's line span untouched.
        for (const [name, contributors] of Object.entries(regionContributors)) {
          if (contributors.length > 1) {
            regions[name].file = `(multiple: ${contributors.join(", ")})`;
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

  const json = JSON.stringify(bundle, null, 2) + "\n";
  for (const outputPath of OUTPUT_PATHS) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
    console.log(
      `\nBundled ${Object.keys(bundle.demos).length} demos to ${outputPath}`,
    );
  }
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

if (process.argv.includes("--watch")) {
  let timer: NodeJS.Timeout | null = null;
  // Track the last failure so transitions are visible. The previous
  // implementation logged a single `[watch] bundle failed` and then fell
  // silent on both repeat failures (no news = assumed fine) and on
  // recovery (no news = actually, it's fine again). Operators reading a
  // dev log couldn't tell either way. Now we log on first-failure,
  // distinguish repeat failures, and emit an explicit "recovered" note
  // when the next successful run clears the state.
  let lastWatchError: Error | null = null;
  const rebundle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        main();
        if (lastWatchError) {
          console.log("[watch] bundle recovered");
          lastWatchError = null;
        }
      } catch (e) {
        const err = e as Error;
        if (lastWatchError && lastWatchError.message === err.message) {
          console.error(`[watch] bundle still failing: ${err.message}`);
        } else {
          console.error("[watch] bundle failed:", err);
        }
        lastWatchError = err;
      }
    }, 200);
  };
  console.log("[watch] watching packages/ for changes...\n");
  // `fs.watch({ recursive: true })` only honours `recursive` on macOS and
  // Windows. On Linux (most CI + many dev boxes) the option is silently
  // ignored: only the top-level directory is watched, so edits to
  // `packages/<x>/src/...` never trigger a rebundle — and the "watching..."
  // log above misleads the operator into thinking they're covered. We
  // can't transparently fix this without adding a dependency (chokidar is
  // not in package.json), so at minimum emit a loud warning at startup so
  // the limitation isn't silent.
  if (process.platform === "linux") {
    console.warn(
      "[watch] WARNING: fs.watch recursive is not supported on Linux — " +
        "watch mode will only detect changes at the top level of " +
        `${PACKAGES_DIR} and will MISS nested edits under ` +
        "packages/<x>/src/...  Run the bundler manually (e.g. " +
        "`tsx ../scripts/bundle-demo-content.ts`) after editing demo " +
        "sources, or add chokidar to scripts/package.json for proper " +
        "recursive watching.",
    );
  }
  fs.watch(PACKAGES_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Normalize separators before matching: `fs.watch` reports paths with
    // the host OS separator, so on Windows the filename is emitted with
    // backslashes (`packages\foo\src\app\demos\...`). The directory
    // patterns below are hardcoded forward-slash, so without this
    // normalization every event on Windows would silently fail to match
    // and the watcher would drop ALL changes.
    const normalized = filename.replace(/\\/g, "/");
    // Rebundle for demo sources, agent sources, READMEs, and — critically —
    // manifest.yaml edits.
    if (
      /(\/demos\/|\/agents\/|\/agent\/|\/mastra\/|README\.md$|manifest\.yaml$)/.test(
        normalized,
      )
    ) {
      rebundle();
    }
  });
}
