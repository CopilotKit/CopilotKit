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
}

interface DemoContent {
  readme: string | null;
  files: DemoFile[];
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

const BACKEND_EXTENSIONS = new Set([".py", ".ts", ".js", ".cs"]);
const SKIP_FILES = new Set(["__init__.py"]);
const SKIP_EXTENSIONS = new Set([".pyc"]);

function isBackendFile(filename: string): boolean {
  if (SKIP_FILES.has(filename)) return false;
  const ext = path.extname(filename).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return false;
  return BACKEND_EXTENSIONS.has(ext);
}

function readFilesFromDir(dir: string, prefix: string): DemoFile[] {
  if (!fs.existsSync(dir)) return [];
  const results: DemoFile[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && isBackendFile(entry.name)) {
      results.push({
        filename: prefix ? `${prefix}/${entry.name}` : entry.name,
        language: detectLanguage(entry.name),
        content: fs.readFileSync(fullPath, "utf-8"),
      });
    } else if (entry.isDirectory() && entry.name !== "__pycache__") {
      // Recurse one level into subdirectories
      const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && isBackendFile(sub.name)) {
          const subPath = path.join(fullPath, sub.name);
          results.push({
            filename: prefix
              ? `${prefix}/${entry.name}/${sub.name}`
              : `${entry.name}/${sub.name}`,
            language: detectLanguage(sub.name),
            content: fs.readFileSync(subPath, "utf-8"),
          });
        }
      }
    }
  }
  return results;
}

function discoverBackendFiles(pkgRoot: string): DemoFile[] {
  const files: DemoFile[] = [];
  const srcDir = path.join(pkgRoot, "src");

  // Pattern 1: src/agent_server.py or src/agent_server.ts
  for (const serverFile of ["agent_server.py", "agent_server.ts"]) {
    const serverPath = path.join(srcDir, serverFile);
    if (fs.existsSync(serverPath)) {
      files.push({
        filename: serverFile,
        language: detectLanguage(serverFile),
        content: fs.readFileSync(serverPath, "utf-8"),
      });
    }
  }

  // Pattern 2: src/agents/ directory
  files.push(...readFilesFromDir(path.join(srcDir, "agents"), "agents"));

  // Pattern 3: src/mastra/ — index.ts + agents/ + tools/
  const mastraDir = path.join(srcDir, "mastra");
  if (fs.existsSync(mastraDir)) {
    const mastraIndex = path.join(mastraDir, "index.ts");
    if (fs.existsSync(mastraIndex)) {
      files.push({
        filename: "mastra/index.ts",
        language: "typescript",
        content: fs.readFileSync(mastraIndex, "utf-8"),
      });
    }
    files.push(
      ...readFilesFromDir(path.join(mastraDir, "agents"), "mastra/agents"),
    );
    files.push(
      ...readFilesFromDir(path.join(mastraDir, "tools"), "mastra/tools"),
    );
  }

  // Pattern 4: src/agent/ directory (e.g. langgraph-typescript)
  files.push(...readFilesFromDir(path.join(srcDir, "agent"), "agent"));

  // Pattern 5: agent/ at package root (e.g. ms-agent-dotnet)
  files.push(...readFilesFromDir(path.join(pkgRoot, "agent"), "agent"));

  // Deduplicate by filename (patterns may overlap for agent/ at root vs src)
  const seen = new Set<string>();
  const deduped: DemoFile[] = [];
  for (const f of files) {
    if (!seen.has(f.filename)) {
      seen.add(f.filename);
      deduped.push(f);
    }
  }

  return deduped;
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
        backend_files?: string[];
      }>;

      const pkgRoot = path.join(PACKAGES_DIR, pkgDir);
      const discoveredBackendFiles = discoverBackendFiles(pkgRoot);

      for (const demo of demos) {
        const routeDir = demo.route.replace(/^\/demos\//, "");
        const demoDir = path.join(
          PACKAGES_DIR,
          pkgDir,
          "src",
          "app",
          "demos",
          routeDir,
        );
        if (!fs.existsSync(demoDir)) continue;

        const key = `${slug}::${demo.id}`;
        const content: DemoContent = {
          readme: null,
          files: [],
          backend_files: [],
        };

        // Resolve this demo's backend files:
        //   - If the manifest lists `backend_files` explicitly, use those
        //     (paths relative to the package root). This keeps per-demo
        //     bundles minimal: a demo with a dedicated graph only shows
        //     its own backend file, not every sibling agent in the package.
        //   - Otherwise, fall back to the legacy full-package scan so
        //     packages that haven't declared per-demo backends still work.
        const scopedBackendFiles: DemoFile[] =
          Array.isArray(demo.backend_files) && demo.backend_files.length > 0
            ? demo.backend_files
                .map((rel) => {
                  const abs = path.join(pkgRoot, rel);
                  if (!fs.existsSync(abs)) return null;
                  return {
                    filename: rel.replace(/^src\//, ""),
                    language: detectLanguage(rel),
                    content: fs.readFileSync(abs, "utf-8"),
                  };
                })
                .filter((f): f is DemoFile => f !== null)
            : discoveredBackendFiles;

        const entries = fs.readdirSync(demoDir);
        for (const entry of entries) {
          const filePath = path.join(demoDir, entry);
          if (!fs.statSync(filePath).isFile()) continue;

          const fileContent = fs.readFileSync(filePath, "utf-8");

          if (entry === "README.md" || entry === "README.mdx") {
            content.readme = fileContent;
          } else {
            content.files.push({
              filename: entry,
              language: detectLanguage(entry),
              content: fileContent,
            });
          }
        }

        // Sort files: page.tsx first, then agent files, then others
        content.files.sort((a, b) => {
          if (a.filename.startsWith("page")) return -1;
          if (b.filename.startsWith("page")) return 1;
          if (a.filename.startsWith("agent")) return -1;
          if (b.filename.startsWith("agent")) return 1;
          return a.filename.localeCompare(b.filename);
        });

        content.backend_files = scopedBackendFiles;

        bundle.demos[key] = content;
        console.log(
          `  ${key}: ${content.files.length} files, ${content.backend_files.length} backend, readme: ${content.readme ? "yes" : "no"}`,
        );
      }
    } catch (err) {
      console.error(`[bundle] Error processing package "${pkgDir}":`, err);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + "\n");
  console.log(
    `\nBundled ${Object.keys(bundle.demos).length} demos to ${OUTPUT_PATH}\n`,
  );
}

main();

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
    // Only rebundle for demo sources, agent sources, and READMEs
    if (
      /(\/demos\/|\/agents\/|\/agent\/|\/mastra\/|README\.md$)/.test(filename)
    ) {
      rebundle();
    }
  });
}
