// Bundle Demo Content
//
// Reads demo source files from all integration packages and produces a JSON
// bundle for the shell's Code tab. The resulting shape is flat:
//
//   demos: Record<"<slug>::<demo-id>", {
//     readme: string | null,
//     files: { filename, language, content, highlighted? }[],
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

interface DemoContent {
  readme: string | null;
  files: DemoFile[];
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
const SKIP_EXTENSIONS = new Set([".pyc"]);

function collectDemoFiles(
  demoDir: string,
  relPrefix: string,
): { readme: string | null; files: DemoFile[] } {
  const out: DemoFile[] = [];
  let readme: string | null = null;

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
      const content = fs.readFileSync(abs, "utf-8");
      if (entry.name === "README.md" || entry.name === "README.mdx") {
        // Use the demo-dir root README as the readme; nested READMEs show
        // up as regular files.
        if (!currentRel && readme === null) {
          readme = content;
          continue;
        }
      }
      out.push({
        filename: relPrefix ? `${relPrefix}/${rel}` : rel,
        language: detectLanguage(entry.name),
        content,
      });
    }
  };

  walk(demoDir, "");

  return { readme, files: out };
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

      const pkgRoot = path.join(PACKAGES_DIR, pkgDir);

      for (const demo of demos) {
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
        const { readme, files } = collectDemoFiles(demoDir, demoRelPrefix);

        // 2. Pull in any highlight: entries that sit OUTSIDE the demo folder
        //    (typically backend agents under src/agents/*). Error if a
        //    highlight path doesn't resolve to a real file.
        const highlightList = demo.highlight ?? [];
        const demoPathSet = new Set(files.map((f) => f.filename));
        for (const hlPath of highlightList) {
          if (demoPathSet.has(hlPath)) continue;
          const absExternal = path.join(pkgRoot, hlPath);
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
          files.push({
            filename: hlPath,
            language: detectLanguage(hlPath),
            content: fs.readFileSync(absExternal, "utf-8"),
          });
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

        bundle.demos[key] = { readme, files };
        const hlCount = files.filter((f) => f.highlighted).length;
        console.log(
          `  ${key}: ${files.length} files${hlCount ? ` (${hlCount} highlighted)` : ""}${readme ? " + README" : ""}`,
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
    // manifest.yaml edits.
    if (
      /(\/demos\/|\/agents\/|\/agent\/|\/mastra\/|README\.md$|manifest\.yaml$)/.test(
        filename,
      )
    ) {
      rebundle();
    }
  });
}
