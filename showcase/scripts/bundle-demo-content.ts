// Bundle Demo Content
//
// Reads demo source files from all integration packages and produces a JSON
// bundle for the shell's Code tab. The resulting shape is flat:
//
//   demos: Record<"<slug>::<demo-id>", {
//     readme: string | null,
//     files: { filename, language, content, highlighted?, highlightOrder? }[],
//     backend_files: [],               // retained for shape back-compat
//     regions: Record<name, Region>,
//   }>
//
// `highlightOrder` mirrors the position of a file inside the manifest's
// `highlight:` array (0-based). Consumers like shell-docs's <DemoSource>
// use it to render tabs in the manifest-author's preferred order rather
// than the bundler's alphabetical fallback. Files not flagged in
// `highlight:` have no `highlightOrder`.
//
// Files are scanned from the demo folder recursively, and any files listed
// in the manifest's `highlight:` field that sit OUTSIDE the demo folder
// (typically `src/agents/<agent>.py`) are merged in with their
// column-relative paths.
//
// Every path in `highlight:` must point to a real bundled file — otherwise
// the bundle fails. This keeps stale references from silently rotting.
//
// Usage: npx tsx showcase/scripts/bundle-demo-content.ts
//
// -----------------------------------------------------------------------------
// Two roots
// -----------------------------------------------------------------------------
// Demo source lives in TWO places and the bundler reads from both:
//
//   frontend demo files → showcase/frontends/nextjs/src/app/[integration]/demos/<demo-id>/
//                         (`[integration]` is a literal directory name — a
//                          Next.js dynamic segment. ONE shared copy of each
//                          demo serves every integration.)
//   backend `highlight:` → showcase/integrations/<slug>/<hlPath>
//
// `manifest.demos[].route` is unchanged and still reads `/demos/<demo-id>`;
// the integration slug lives in `backend_url`, so the `routeDir` derivation
// below keeps working for both roots.
//
// The bundled `filename` prefix stays `src/app/demos/<routeDir>/…` no matter
// which root a file came from. Manifest `highlight:` entries and docs
// `<Snippet file="src/app/demos/…">` call sites address files by that path,
// so it is part of the bundle's public contract — not an implementation
// detail of where the file happens to sit on disk.
//
// -----------------------------------------------------------------------------
// Integration-slug substitution (deliberate divergence from the file on disk)
// -----------------------------------------------------------------------------
// A ported demo page reads its integration from the URL:
//
//     const { integration } = useParams<{ integration: string }>();
//     <CopilotKit runtimeUrl={`/api/${integration}/agentic-chat`} …>
//
// That is right for the showcase (one page, every backend) but wrong for
// docs: a reader on the LangGraph page must see something they can paste.
// So when bundling for integration X the bundler rewrites the template
// literal to the concrete path and drops the now-unused `useParams` line and
// its import.
//
// This means the emitted snippet DIFFERS from the file on disk, on purpose.
// It is the same class of transform as the `@region` marker stripping below,
// just more visible. The rewrite is conservative: anything that does not
// match the exact expected shape is emitted UNCHANGED and reported on
// stdout, because a wrong rewrite in published docs is worse than an
// unrewritten one.
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
import {
  describeDuplicateRegion,
  findUnexpectedDuplicateRegions,
} from "./lib/demo-region-guard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "integrations");
// The unified frontend app. `[integration]` is a literal directory name (a
// Next.js dynamic segment), not a placeholder to interpolate.
export const UNIFIED_DEMOS_DIR = path.join(
  ROOT,
  "frontends",
  "nextjs",
  "src",
  "app",
  "[integration]",
  "demos",
);
// demo-content is consumed by ALL shells:
//   - shell: integration pages + demo drawer read the bundle at runtime
//   - shell-docs: <Snippet> (docs routes) imports directly at build time
//   - shell-dojo: demo content renders inside the dojo's cell viewer
// so we multi-emit. Paths array is iterated at write time.
const OUTPUT_PATHS = [
  path.join(ROOT, "shell", "src", "data", "demo-content.json"),
  path.join(ROOT, "shell-docs", "src", "data", "demo-content.json"),
  path.join(ROOT, "shell-dojo", "src", "data", "demo-content.json"),
];

interface DemoFile {
  filename: string;
  language: string;
  content: string;
  highlighted?: boolean;
  /**
   * 0-based index of the file inside the manifest's `highlight:` array.
   * Present iff `highlighted` is true. Lets consumers render highlighted
   * files in author-defined order without re-doing the manifest lookup.
   */
  highlightOrder?: number;
}

interface Region {
  /** Source file (relative to the demo root / column root for externals). */
  file: string;
  /** 1-based line number of the first line inside the region (post strip). */
  startLine: number;
  /**
   * 1-based INCLUSIVE line number of the last line inside the region.
   *
   * EMPTY REGION INVERSION: a region with no body lines cannot have an
   * inclusive last line, so it is emitted as `startLine - 1` — deliberately
   * one BELOW `startLine`, and `0` when the region opens on line 1. Consumers
   * must treat `endLine < startLine` as "empty span", not as a line number.
   */
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
    ".java": "java",
    ".css": "css",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".xml": "xml",
    ".md": "markdown",
    ".mdx": "markdown",
  };
  return map[ext] || "text";
}

// Skip generated / OS noise when walking demo folders.
//
// Exported because verify-shell-docs.ts walks the SAME trees to pre-flight the
// bundler's duplicate-region hard error. When these lists were hand-copied
// there, the two walkers could disagree about which files exist, so the
// verifier passed and `nx build` then failed on the same tree.
export const SKIP_EXACT = new Set([".DS_Store", "Thumbs.db"]);
export const SKIP_DIRS = new Set(["__pycache__", "node_modules", ".next"]);
// Extensions to skip entirely. Includes compiled Python artefacts (.pyc) and
// binary-like assets we should NEVER pass through `fs.readFileSync(..., "utf-8")`
// — doing so mangles the bytes and injects garbage strings into the bundled
// `demo-content.json`. Images, fonts, archives, and PDFs all belong here.
export const SKIP_EXTENSIONS = new Set([
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
 * Every well-formed region name opened in `source`, in file order, WITH
 * repeats — two `@region[x]` markers in one file yield `["x", "x"]`.
 *
 * Exported so verify-shell-docs.ts scans with the bundler's own pattern
 * instead of a hand-copied twin. A fresh `RegExp` per call keeps `lastIndex`
 * from leaking between callers.
 */
export function findRegionStartNames(source: string): string[] {
  const re = new RegExp(REGION_START_RE.source, "g");
  return [...source.matchAll(re)].map((m) => m[1]);
}

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

// ---------------------------------------------------------------------------
// Demo-folder resolution (two roots)
// ---------------------------------------------------------------------------

export type DemoDirOrigin = "unified" | "integration";

export interface ResolvedDemoDir {
  dir: string;
  origin: DemoDirOrigin;
}

/**
 * Whether `candidate` is a directory, FOLLOWING symlinks.
 *
 * One `statSync` in a try/catch (not `existsSync` + `statSync`, which is a
 * time-of-check/time-of-use race). Mirrors `isDirectoryFollowingLinks` in
 * generate-registry.ts and `isDirectory` in
 * showcase/frontends/nextjs/src/lib/integration-support.ts.
 */
function isDirectoryFollowingLinks(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a demo's frontend folder. Prefers the unified app; falls back to
 * the integration's own `src/app/demos/<routeDir>`.
 *
 * TEMPORARY FALLBACK — during the migration BOTH layouts exist: most
 * integrations still carry their own `src/app/demos/`, while the unified app
 * has the ported copies. DELETE the `integration` branch (and this comment)
 * once every demo is ported to
 * `showcase/frontends/nextjs/src/app/[integration]/demos/`.
 *
 * Returns null when neither root has the folder — the caller turns that into
 * a hard error naming the slug and demo id.
 */
export function resolveDemoDir(
  pkgRoot: string,
  routeDir: string,
  unifiedRoot: string = UNIFIED_DEMOS_DIR,
): ResolvedDemoDir | null {
  const unified = path.join(unifiedRoot, routeDir);
  if (fs.existsSync(unified) && fs.statSync(unified).isDirectory()) {
    return { dir: unified, origin: "unified" };
  }
  const legacy = path.join(pkgRoot, "src", "app", "demos", routeDir);
  if (fs.existsSync(legacy) && fs.statSync(legacy).isDirectory()) {
    return { dir: legacy, origin: "integration" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Integration-slug substitution
// ---------------------------------------------------------------------------

/**
 * `runtimeUrl={`/api/${integration}/<demo-id>`}` — the ONE shape we rewrite.
 * Anything else (a computed base, a variable demo id, a different prop) is
 * left alone on purpose.
 */
const RUNTIME_URL_TEMPLATE_RE =
  /runtimeUrl=\{`\/api\/\$\{integration\}\/([A-Za-z0-9._~-]+)`\}/g;

/** `const { integration } = useParams<{ integration: string }>();` */
const USE_PARAMS_DESTRUCTURE_RE =
  /^[ \t]*const\s*\{\s*integration\s*\}\s*=\s*useParams<\{\s*integration\s*:\s*string\s*;?\s*\}>\(\)\s*;?[ \t]*\r?\n/m;

/** `import { useParams } from "next/navigation";` (sole named import). */
const USE_PARAMS_IMPORT_RE =
  /^[ \t]*import\s*\{\s*useParams\s*\}\s*from\s*["']next\/navigation["']\s*;?[ \t]*\r?\n/m;

/**
 * Blank out comments so the "is this identifier still used?" checks below
 * don't trip over prose. Only used for detection — never for emitted output.
 * The `[^:]` guard keeps `https://…` inside a string from being read as the
 * start of a line comment.
 */
function stripCommentsForCheck(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export interface SlugSubstitution {
  content: string;
  /** How many `runtimeUrl` template literals were rewritten. */
  rewrites: number;
  /** True when the `useParams` destructure + import were dropped. */
  droppedUseParams: boolean;
  /**
   * Reasons this file was NOT fully rewritten. Empty means "nothing left to
   * do". Non-empty entries are surfaced on stdout so an author can look.
   */
  unmatched: string[];
}

/**
 * Rewrite a ported demo file so the emitted snippet names a concrete
 * integration slug instead of reading it from the URL.
 *
 * Deliberately conservative — see the header block. When the provider line
 * does not match the expected shape the content is returned unchanged and the
 * reason is recorded in `unmatched`.
 */
export function substituteIntegrationSlug(
  source: string,
  slug: string,
): SlugSubstitution {
  const usesParam = source.includes("${integration}");
  const importsUseParams = /\buseParams\b/.test(source);
  if (!usesParam && !importsUseParams) {
    return {
      content: source,
      rewrites: 0,
      droppedUseParams: false,
      unmatched: [],
    };
  }

  let rewrites = 0;
  RUNTIME_URL_TEMPLATE_RE.lastIndex = 0;
  let content = source.replace(RUNTIME_URL_TEMPLATE_RE, (_m, demoPath) => {
    rewrites++;
    return `runtimeUrl="/api/${slug}/${demoPath}"`;
  });

  const unmatched: string[] = [];
  if (usesParam && rewrites === 0) {
    unmatched.push(
      "references ${integration} but no runtimeUrl template literal matched the expected shape",
    );
  }

  // Only drop the plumbing once nothing in the code still needs it. If the
  // param is read anywhere else, keep the destructure AND the import —
  // emitting a file that references an undeclared `integration` would be
  // worse than emitting one extra line.
  let droppedUseParams = false;
  if (rewrites > 0) {
    const withoutDestructure = content.replace(USE_PARAMS_DESTRUCTURE_RE, "");
    const destructureRemoved = withoutDestructure !== content;
    const stillUsesParam = /\bintegration\b/.test(
      stripCommentsForCheck(withoutDestructure),
    );
    if (destructureRemoved && !stillUsesParam) {
      content = withoutDestructure;
      droppedUseParams = true;
      const withoutImport = content.replace(USE_PARAMS_IMPORT_RE, "");
      if (/\buseParams\b/.test(stripCommentsForCheck(withoutImport))) {
        // `useParams` is called again elsewhere — keep the import.
        unmatched.push(
          "useParams is used beyond the integration destructure; import kept",
        );
      } else {
        content = withoutImport;
      }
    } else if (!destructureRemoved) {
      unmatched.push(
        "useParams destructure did not match the expected shape; left in place",
      );
    } else {
      unmatched.push(
        "the integration param is read elsewhere in the file; useParams kept",
      );
    }
  }

  return { content, rewrites, droppedUseParams, unmatched };
}

/**
 * Bundled-path prefix for every frontend demo file, regardless of which root
 * it was read from. Part of the bundle's public contract (manifests and docs
 * `<Snippet file="…">` address files by it).
 */
export const DEMO_PATH_PREFIX = "src/app/demos/";

/** Extensions that can carry the `<CopilotKit runtimeUrl=…>` provider line. */
const SLUG_SUBSTITUTION_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

/** Per-demo tally of what the slug substitution did, for the run summary. */
export interface SlugRewriteStats {
  filesRewritten: number;
  filesPassedThrough: Array<{ file: string; reasons: string[] }>;
}

function collectDemoFiles(
  demoDir: string,
  relPrefix: string,
  demoKey: string,
  slug: string,
  stats: SlugRewriteStats,
): {
  readme: string | null;
  files: DemoFile[];
  perFileRegions: Record<string, Record<string, ExtractedRegion[]>>;
} {
  const out: DemoFile[] = [];
  let readme: string | null = null;
  const perFileRegions: Record<string, Record<string, ExtractedRegion[]>> = {};

  // Realpaths of directories already walked. `withFileTypes` has LSTAT
  // semantics, so following symlinked subdirectories (below) reintroduces the
  // possibility of a cycle that plain lstat-based recursion could not hit.
  // A directory is walked at most once, keyed by its resolved identity.
  const visitedDirs = new Set<string>();

  const walk = (absDir: string, currentRel: string) => {
    const realDir = fs.realpathSync(absDir);
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_EXACT.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
      // `withFileTypes` has LSTAT semantics: a symlink POINTING AT a directory
      // reports isSymbolicLink() === true and isDirectory() === false, so a
      // bare `entry.isDirectory()` branch fell through to the `!entry.isFile()`
      // guard below and dropped the whole subtree wordlessly — the demo shipped
      // with those files missing from its Code tab and nothing said so.
      // `statSync` follows the link.
      if (
        entry.isDirectory() ||
        (entry.isSymbolicLink() && isDirectoryFollowingLinks(abs))
      ) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs, rel);
        continue;
      }
      // A symlink to a FILE also reports isFile() === false under lstat
      // semantics; resolve it the same way so a linked source file is bundled
      // rather than silently skipped.
      if (!entry.isFile()) {
        if (!entry.isSymbolicLink()) continue;
        try {
          if (!fs.statSync(abs).isFile()) continue;
        } catch {
          continue;
        }
      }
      if (SKIP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const raw = fs.readFileSync(abs, "utf-8");
      const bundledPath = relPrefix ? `${relPrefix}/${rel}` : rel;
      // Substitute the concrete integration slug BEFORE region extraction so
      // region bodies carry the rewritten text and their line spans match the
      // emitted file. Only source files can hold the provider line.
      let source = raw;
      // Lower-case the extension before the lookup, exactly like the
      // SKIP_EXTENSIONS check above. Without it a `Page.TSX` skips the
      // rewrite and ships a docs snippet that still reads the integration
      // slug from the URL.
      if (
        SLUG_SUBSTITUTION_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        const sub = substituteIntegrationSlug(raw, slug);
        source = sub.content;
        if (sub.rewrites > 0) stats.filesRewritten++;
        if (sub.unmatched.length > 0) {
          stats.filesPassedThrough.push({
            file: bundledPath,
            reasons: sub.unmatched,
          });
        }
      }
      // Extract & strip region markers before anything else sees the text.
      // Label with the BUNDLED path, not the demo-folder-relative one. The
      // external-highlight loop in main() labels its errors `${key}:${hlPath}`
      // — a column-relative path — so using `rel` here put two different
      // address spaces in one error stream and an operator could not tell
      // which root a reported file lived under.
      const { cleaned, regions: fileRegions } = extractRegions(
        source,
        `${demoKey}:${bundledPath}`,
      );
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
    demos: {},
  };
  const slugStats: SlugRewriteStats = {
    filesRewritten: 0,
    filesPassedThrough: [],
  };
  // Demos still served by the TEMPORARY integration fallback in
  // resolveDemoDir(). Should shrink to zero as the port completes.
  const fallbackResolved: string[] = [];

  if (!fs.existsSync(PACKAGES_DIR)) {
    console.log("No packages directory found.");
    const json = JSON.stringify(bundle, null, 2) + "\n";
    for (const outputPath of OUTPUT_PATHS) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, json);
    }
    return;
  }

  // `withFileTypes` has LSTAT semantics: a symlink POINTING AT a directory
  // reports isSymbolicLink() === true and isDirectory() === false, so the bare
  // `d.isDirectory()` filter dropped it wordlessly — no manifest read, no demo
  // docs, no error. generate-registry.ts DOES follow such a link (see
  // `findManifests` there, and `readManifests` in the frontend's
  // integration-support.ts), so a symlinked integration got a registry entry
  // and was served by the app while this bundler emitted zero docs for every
  // one of its demos. `statSync` follows the link.
  const packageDirs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() ||
        (d.isSymbolicLink() &&
          isDirectoryFollowingLinks(path.join(PACKAGES_DIR, d.name))),
    )
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
        const resolved = resolveDemoDir(pkgRoot, routeDir);
        if (!resolved) {
          throw new Error(
            `${slug}::${demo.id}: demo folder does not exist at ` +
              `${path.join(UNIFIED_DEMOS_DIR, routeDir)} (unified frontend) ` +
              `nor ${path.join(pkgRoot, "src", "app", "demos", routeDir)} ` +
              `(integration fallback).`,
          );
        }
        const demoDir = resolved.dir;
        if (resolved.origin === "integration") {
          fallbackResolved.push(`${slug}::${demo.id}`);
        }
        // Root that `src/app/demos/…` highlight paths resolve against. Same
        // root the demo folder itself came from, so a demo served by the
        // temporary fallback keeps reading its own package.
        const frontendDemosRoot =
          resolved.origin === "unified"
            ? UNIFIED_DEMOS_DIR
            : path.join(pkgRoot, "src", "app", "demos");

        const key = `${slug}::${demo.id}`;

        // 1. Collect the demo folder's contents.
        //    The bundled `filename` for each is prefixed with the
        //    column-relative path so highlight: entries can be matched as
        //    full column-relative paths.
        //    That prefix is deliberately independent of which root the file
        //    came from — it is the address docs and manifests already use.
        const demoRelPrefix = `src/app/demos/${routeDir}`;
        const { readme, files, perFileRegions } = collectDemoFiles(
          demoDir,
          demoRelPrefix,
          key,
          slug,
          slugStats,
        );

        // 2. Pull in any highlight: entries that sit OUTSIDE the demo folder
        //    (typically backend agents under src/agents/*). Error if a
        //    highlight path doesn't resolve to a real file.
        const highlightList = demo.highlight ?? [];
        // Set of every path already bundled. It MUST be updated as external
        // highlights are appended, not just seeded from the demo folder:
        // a manifest is free to list the same `highlight:` path twice (and
        // several do), and a stale set would read, slug-rewrite,
        // region-extract and push that file once PER occurrence. That ships
        // duplicate tabs in the `/code` viewer and — worse — makes the region
        // collapse loop below concatenate a duplicated file's region body once
        // per duplicate. The `highlightIndex` map further down already
        // de-duplicates; this loop is the half that did not.
        const bundledPaths = new Set(files.map((f) => f.filename));
        for (const hlPath of highlightList) {
          if (bundledPaths.has(hlPath)) continue;
          // Which root owns this path? A `src/app/demos/…` entry is FRONTEND
          // source (usually another demo's file — e.g. ag2::beautiful-chat
          // highlights declarative-gen-ui's a2ui catalog), so it must resolve
          // against the frontend demos root. The integration package is NOT a
          // fallback for those: it still carries its pre-port private copy,
          // and silently reading that would mix two different demo shapes
          // into one bundle. Everything else (`src/agents/*.py`,
          // `agent/*.cs`, `src/app/api/*`) stays with the integration.
          const isFrontendDemoPath = hlPath.startsWith(DEMO_PATH_PREFIX);
          const absExternal = isFrontendDemoPath
            ? path.join(
                frontendDemosRoot,
                hlPath.slice(DEMO_PATH_PREFIX.length),
              )
            : path.join(pkgRoot, hlPath);
          if (!fs.existsSync(absExternal)) {
            throw new Error(
              `${key}: highlight path "${hlPath}" not found in demo folder nor at ${absExternal}` +
                (isFrontendDemoPath
                  ? ` (resolved against the ${resolved.origin === "unified" ? "unified frontend" : "integration fallback"} demos root). ` +
                    `Update manifest.highlight for ${slug} — the shared demo does not contain that file.`
                  : "."),
            );
          }
          if (!fs.statSync(absExternal).isFile()) {
            throw new Error(
              `${key}: highlight path "${hlPath}" exists but is not a regular file.`,
            );
          }
          let raw = fs.readFileSync(absExternal, "utf-8");
          // Frontend demo source pulled in from another demo folder needs the
          // same slug substitution the demo's own files got.
          if (
            isFrontendDemoPath &&
            SLUG_SUBSTITUTION_EXTENSIONS.has(path.extname(hlPath).toLowerCase())
          ) {
            const sub = substituteIntegrationSlug(raw, slug);
            raw = sub.content;
            if (sub.rewrites > 0) slugStats.filesRewritten++;
            if (sub.unmatched.length > 0) {
              slugStats.filesPassedThrough.push({
                file: hlPath,
                reasons: sub.unmatched,
              });
            }
          }
          const { cleaned, regions: fileRegions } = extractRegions(
            raw,
            `${key}:${hlPath}`,
          );
          files.push({
            filename: hlPath,
            language: detectLanguage(hlPath),
            content: cleaned,
          });
          bundledPaths.add(hlPath);
          if (Object.keys(fileRegions).length > 0) {
            perFileRegions[hlPath] = fileRegions;
          }
        }

        // 3. Apply highlights. All `highlight:` entries must now resolve to
        //    bundled files (the step above guarantees that for external
        //    files; for files inside the demo folder we check here).
        //    `highlightOrder` records the manifest position (0-based) so
        //    consumers can render highlighted files in the author's order
        //    rather than the bundler's alphabetical fallback.
        const highlightIndex = new Map<string, number>();
        highlightList.forEach((h, idx) => {
          if (!highlightIndex.has(h)) highlightIndex.set(h, idx);
        });
        const bundled = new Set(files.map((f) => f.filename));
        for (const h of highlightIndex.keys()) {
          if (!bundled.has(h)) {
            throw new Error(
              `${key}: manifest.highlight lists "${h}" but that file isn't in the bundle.`,
            );
          }
        }
        for (const f of files) {
          const order = highlightIndex.get(f.filename);
          if (order !== undefined) {
            f.highlighted = true;
            f.highlightOrder = order;
          }
        }

        // Stable order: page.* first, then everything else alphabetical.
        files.sort((a, b) => {
          const aIsPage = /(^|\/)page\.[tj]sx?$/.test(a.filename);
          const bIsPage = /(^|\/)page\.[tj]sx?$/.test(b.filename);
          if (aIsPage !== bIsPage) return aIsPage ? -1 : 1;
          return a.filename.localeCompare(b.filename);
        });

        // Collapse per-file regions into the public map in file-order. For
        // multi-file regions we concatenate bodies with a blank separator and
        // use the FIRST file's line span (there's no single coherent range
        // across files — this is a best-effort pointer for tooling).
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
        const fileOrder = files.map((f) => f.filename);
        const knownInFiles = new Set(fileOrder);
        const leftoverKeys = Object.keys(perFileRegions)
          .filter((k) => !knownInFiles.has(k))
          .sort();
        const effectiveOrder = [...fileOrder, ...leftoverKeys];

        // Tally BOTH the contributing files and the total slice count. The
        // guard decides on the slice count: the collapse loop below
        // concatenates every slice of a name, so two `@region[x]` blocks in
        // ONE file are silently glued together exactly like a cross-file
        // duplicate. Counting distinct files alone let that case through
        // without even needing an allowlist entry.
        const regionSources = new Map<
          string,
          { files: Set<string>; sliceCount: number }
        >();
        for (const filename of effectiveOrder) {
          const fileRegs = perFileRegions[filename];
          if (!fileRegs) continue;
          for (const [name, slices] of Object.entries(fileRegs)) {
            if (slices.length === 0) continue;
            const entry = regionSources.get(name) ?? {
              files: new Set<string>(),
              sliceCount: 0,
            };
            entry.files.add(filename);
            entry.sliceCount += slices.length;
            regionSources.set(name, entry);
          }
        }
        const unexpectedDuplicateRegions = findUnexpectedDuplicateRegions(
          [...regionSources.entries()].map(([regionName, entry]) => ({
            demoKey: key,
            demoId: demo.id,
            regionName,
            files: [...entry.files],
            sliceCount: entry.sliceCount,
          })),
        );
        if (unexpectedDuplicateRegions.length > 0) {
          const details = unexpectedDuplicateRegions
            .map(
              (source) =>
                `${key}: region "${source.regionName}" ${describeDuplicateRegion(source)}`,
            )
            .join("\n\n");
          throw new Error(
            `${details}\n\nRename/delete the accidental duplicate region, or add an explicit allowlist entry in showcase/scripts/lib/demo-region-guard.ts if this is an intentional concatenated snippet.`,
          );
        }

        for (const filename of effectiveOrder) {
          const fileRegs = perFileRegions[filename];
          if (!fileRegs) continue;
          for (const [name, slices] of Object.entries(fileRegs)) {
            for (const slice of slices) {
              if (regions[name]) {
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
        { cause: err },
      );
    }
  }

  console.log(
    `\nSlug substitution: ${slugStats.filesRewritten} files rewritten, ` +
      `${slugStats.filesPassedThrough.length} passed through unchanged.`,
  );
  for (const { file, reasons } of slugStats.filesPassedThrough) {
    console.log(`  ${file}: ${reasons.join("; ")}`);
  }
  if (fallbackResolved.length > 0) {
    console.log(
      `\n${fallbackResolved.length} demos resolved from the TEMPORARY integration fallback ` +
        `(not yet ported to the unified frontend):`,
    );
    for (const key of fallbackResolved) console.log(`  ${key}`);
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

// Run only when this file is the process entrypoint. Tests import the pure
// helpers above (resolveDemoDir / substituteIntegrationSlug) and must not
// trigger a full bundle as a side effect. Every real caller invokes
// `tsx bundle-demo-content.ts`, so the entry basename check is exact; the
// realpath comparison covers symlinked or compiled invocations.
const isEntrypoint = (() => {
  const argvEntry = process.argv[1];
  if (!argvEntry) return false;
  const resolvedEntry = path.resolve(argvEntry);
  if (resolvedEntry === __filename) return true;
  return (
    path.basename(resolvedEntry).replace(/\.[cm]?[jt]s$/, "") ===
    "bundle-demo-content"
  );
})();

const watchMode = isEntrypoint && process.argv.includes("--watch");

// Track the last failure so transitions are visible. The previous
// implementation logged a single `[watch] bundle failed` and then fell
// silent on both repeat failures (no news = assumed fine) and on
// recovery (no news = actually, it's fine again). Operators reading a
// dev log couldn't tell either way. Now we log on first-failure,
// distinguish repeat failures, and emit an explicit "recovered" note
// when the next successful run clears the state.
//
// Declared out here (not inside the watch block) so the FIRST bundle —
// which runs before watching starts — can seed it.
let lastWatchError: Error | null = null;

if (isEntrypoint) {
  try {
    main();
  } catch (err) {
    console.error((err as Error).message);
    if (!watchMode) process.exit(1);
    // Under --watch a failing first bundle is exactly the case the watcher
    // exists for: exiting here meant a single bad region marker killed the
    // watcher instead of waiting for the fix, and made the recovery logging
    // below unreachable. Stay alive and record the failure so the next
    // successful rebundle reports "recovered".
    lastWatchError = err as Error;
    console.error(
      "[watch] initial bundle failed — watching for changes anyway.",
    );
  }
}

if (watchMode) {
  let timer: NodeJS.Timeout | null = null;
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
  console.log(
    "[watch] watching integrations/ and the unified frontend demos for changes...\n",
  );
  // Guarded exactly like the unified-demos watcher below. `main()` already
  // treats a missing integrations/ as a legitimate state (it writes an empty
  // bundle and returns), so an unguarded `fs.watch` here threw an uncaught
  // ENOENT — OUTSIDE the try/catch that exists to keep the watcher alive —
  // and killed the watch the moment the directory was absent.
  if (fs.existsSync(PACKAGES_DIR)) {
    fs.watch(PACKAGES_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      // Rebundle for demo sources, agent sources, READMEs, and — critically —
      // manifest.yaml edits.
      if (
        /([\\/]demos[\\/]|[\\/]agents[\\/]|[\\/]agent[\\/]|[\\/]mastra[\\/]|README\.md$|manifest\.yaml$)/.test(
          filename,
        )
      ) {
        rebundle();
      }
    });
  }
  // Frontend demo source now lives in the unified app, so watch it too —
  // otherwise editing a ported demo produces no rebundle.
  if (fs.existsSync(UNIFIED_DEMOS_DIR)) {
    fs.watch(UNIFIED_DEMOS_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      rebundle();
    });
  }
}
