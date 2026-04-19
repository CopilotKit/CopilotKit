// Bundle Demo Content
//
// Reads demo source files and READMEs from all integration packages
// and produces a JSON bundle for the shell's Code and Docs tabs.
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
  // Retained for JSON shape back-compat; always empty under the new rule
  // that `/code` shows only the demo folder's actual contents.
  backend_files: DemoFile[];
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

function collectDemoFiles(demoDir: string): {
  readme: string | null;
  files: DemoFile[];
} {
  const out: DemoFile[] = [];
  let readme: string | null = null;

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
      const content = fs.readFileSync(abs, "utf-8");
      if (entry.name === "README.md" || entry.name === "README.mdx") {
        // Use the root-level README as the demo readme; nested README files
        // just show up as regular files.
        if (!relPrefix && readme === null) {
          readme = content;
          continue;
        }
      }
      out.push({
        filename: rel,
        language: detectLanguage(entry.name),
        content,
      });
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

      for (const demo of demos) {
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
        const { readme, files } = collectDemoFiles(demoDir);

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

        bundle.demos[key] = { readme, files, backend_files: [] };
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
