// Bundle Starter Content
//
// Reads registry.json to find integrations with starter data,
// then bundles key source files from each starter example into
// a JSON file the shell can consume for displaying starter code.
//
// Usage: npx tsx showcase/scripts/bundle-starter-content.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");
const REGISTRY_PATH = path.join(ROOT, "shell", "src", "data", "registry.json");
const OUTPUT_PATH = path.join(
  ROOT,
  "shell",
  "src",
  "data",
  "starter-content.json",
);

const MAX_FILE_SIZE = 50 * 1024; // 50KB

interface StarterFile {
  filename: string;
  language: string;
  content: string;
}

interface StarterContent {
  files: StarterFile[];
  readme: string | null;
}

interface BundledStarters {
  starters: Record<string, StarterContent>;
}

interface RegistryIntegration {
  slug: string;
  starter?: {
    path: string;
    name: string;
    description?: string;
    github_url?: string;
  };
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
    ".sh": "bash",
    ".mjs": "javascript",
    ".java": "java",
  };
  if (path.basename(filename) === "Dockerfile") return "dockerfile";
  return map[ext] || "text";
}

function tryReadFile(
  filePath: string,
  displayName: string,
): StarterFile | null {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    console.log(
      `    SKIP ${displayName} (${(stat.size / 1024).toFixed(1)}KB > 50KB)`,
    );
    return null;
  }
  return {
    filename: displayName,
    language: detectLanguage(filePath),
    content: fs.readFileSync(filePath, "utf-8"),
  };
}

// Search candidate paths and return the first file found
function findFile(
  basePath: string,
  candidates: string[],
  displayPrefix?: string,
): StarterFile | null {
  for (const candidate of candidates) {
    const fullPath = path.join(basePath, candidate);
    const displayName = displayPrefix
      ? `${displayPrefix}/${candidate}`
      : candidate;
    const file = tryReadFile(fullPath, displayName);
    if (file) return file;
  }
  return null;
}

// Recursively collect backend/agent files from a directory
function collectAgentFiles(dir: string, prefix: string): StarterFile[] {
  if (!fs.existsSync(dir)) return [];
  const results: StarterFile[] = [];
  const SKIP = new Set([
    "__pycache__",
    "node_modules",
    ".ruff_cache",
    "__init__.py",
  ]);
  const EXTENSIONS = new Set([".py", ".ts", ".js", ".cs", ".java"]);

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const displayName = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (
      entry.isFile() &&
      EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      const file = tryReadFile(fullPath, displayName);
      if (file) results.push(file);
    } else if (entry.isDirectory()) {
      results.push(...collectAgentFiles(fullPath, displayName));
    }
  }
  return results;
}

function discoverStarterFiles(starterPath: string): StarterFile[] {
  const files: StarterFile[] = [];
  const isTurborepo = fs.existsSync(path.join(starterPath, "apps"));

  if (isTurborepo) {
    // Turborepo layout: apps/app (or apps/web) for frontend, apps/agent for backend

    // Frontend: look in apps/app or apps/web
    const frontendApps = ["apps/app", "apps/web"];
    for (const appDir of frontendApps) {
      const appBase = path.join(starterPath, appDir);
      if (!fs.existsSync(appBase)) continue;

      // Main page
      const page = findFile(appBase, ["src/app/page.tsx", "src/app/page.ts"]);
      if (page) {
        page.filename = `${appDir}/${page.filename}`;
        files.push(page);
      }

      // API route
      const route = findFile(appBase, [
        "src/app/api/copilotkit/route.ts",
        "src/app/api/copilotkit/route.js",
      ]);
      if (route) {
        route.filename = `${appDir}/${route.filename}`;
        files.push(route);
      }
    }

    // Backend: look in apps/agent
    const agentDir = path.join(starterPath, "apps", "agent");
    if (fs.existsSync(agentDir)) {
      // Top-level agent source files
      const AGENT_EXTENSIONS = new Set([".py", ".ts", ".js", ".cs", ".java"]);
      const AGENT_SKIP = new Set(["__init__.py"]);
      const agentEntries = fs.readdirSync(agentDir, { withFileTypes: true });
      for (const entry of agentEntries) {
        if (!entry.isFile()) continue;
        if (AGENT_SKIP.has(entry.name)) continue;
        if (!AGENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
          continue;
        const file = tryReadFile(
          path.join(agentDir, entry.name),
          `apps/agent/${entry.name}`,
        );
        if (file) files.push(file);
      }

      // Then collect from src/
      const srcFiles = collectAgentFiles(
        path.join(agentDir, "src"),
        "apps/agent/src",
      );
      files.push(...srcFiles);
    }
  } else {
    // Standard layout: single Next.js app with optional agent/ directory

    // Main page
    const page = findFile(starterPath, [
      "src/app/page.tsx",
      "src/app/page.ts",
      "app/page.tsx",
      "app/page.ts",
    ]);
    if (page) files.push(page);

    // API route
    const route = findFile(starterPath, [
      "src/app/api/copilotkit/route.ts",
      "src/app/api/copilotkit/route.js",
      "app/api/copilotkit/route.ts",
      "app/api/copilotkit/route.js",
    ]);
    if (route) files.push(route);

    // Agent files: agent/ directory at root
    const agentDir = path.join(starterPath, "agent");
    if (fs.existsSync(agentDir)) {
      // Top-level agent source files (e.g. main.py, Program.cs, SharedStateAgent.cs)
      const AGENT_EXTENSIONS = new Set([".py", ".ts", ".js", ".cs", ".java"]);
      const AGENT_SKIP = new Set(["__init__.py"]);
      const agentEntries = fs.readdirSync(agentDir, { withFileTypes: true });
      for (const entry of agentEntries) {
        if (!entry.isFile()) continue;
        if (AGENT_SKIP.has(entry.name)) continue;
        if (!AGENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
          continue;
        const file = tryReadFile(
          path.join(agentDir, entry.name),
          `agent/${entry.name}`,
        );
        if (file) files.push(file);
      }
      // Collect from agent subdirectories (src/, java/, etc.)
      const agentSubdirs = fs
        .readdirSync(agentDir, { withFileTypes: true })
        .filter((e) => e.isDirectory());
      for (const subdir of agentSubdirs) {
        const subFiles = collectAgentFiles(
          path.join(agentDir, subdir.name),
          `agent/${subdir.name}`,
        );
        files.push(...subFiles);
      }
    }

    // Mastra: src/mastra/ directory
    const mastraDir = path.join(starterPath, "src", "mastra");
    if (fs.existsSync(mastraDir)) {
      const mastraFiles = collectAgentFiles(mastraDir, "src/mastra");
      files.push(...mastraFiles);
    }

    // .NET agent files at agent/ root (e.g. Program.cs, SharedStateAgent.cs)
    // Already handled above via collectAgentFiles

    // Sales Dashboard components (starters)
    const componentDirs = [
      "src/components/sales-dashboard",
      "src/components/renderers",
      "src/components/charts",
    ];
    for (const compDir of componentDirs) {
      const fullDir = path.join(starterPath, compDir);
      if (fs.existsSync(fullDir)) {
        const compFiles = collectAgentFiles(fullDir, compDir);
        files.push(...compFiles);
      }
    }

    // Config files (Dockerfile, entrypoint.sh, postcss.config.mjs)
    const configFiles = ["Dockerfile", "entrypoint.sh", "postcss.config.mjs"];
    for (const cf of configFiles) {
      const file = tryReadFile(path.join(starterPath, cf), cf);
      if (file) files.push(file);
    }
  }

  // Deduplicate by filename
  const seen = new Set<string>();
  const deduped: StarterFile[] = [];
  for (const f of files) {
    if (!seen.has(f.filename)) {
      seen.add(f.filename);
      deduped.push(f);
    }
  }

  return deduped;
}

function main() {
  console.log("Bundling starter content...\n");

  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(
      `Registry not found at ${REGISTRY_PATH}. Run generate-registry.ts first.`,
    );
    process.exit(1);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  const integrations = registry.integrations as RegistryIntegration[];

  const bundle: BundledStarters = {
    starters: {},
  };

  let starterCount = 0;

  for (const integration of integrations) {
    if (!integration.starter) continue;

    const starterPath = path.join(REPO_ROOT, integration.starter.path);
    if (!fs.existsSync(starterPath)) {
      console.log(
        `  WARN: ${integration.slug} starter path not found: ${integration.starter.path}`,
      );
      continue;
    }

    console.log(`  ${integration.slug}:`);

    const files = discoverStarterFiles(starterPath);

    // Read README
    let readme: string | null = null;
    const readmePath = path.join(starterPath, "README.md");
    if (fs.existsSync(readmePath)) {
      const stat = fs.statSync(readmePath);
      if (stat.size <= MAX_FILE_SIZE) {
        readme = fs.readFileSync(readmePath, "utf-8");
      }
    }

    bundle.starters[integration.slug] = { files, readme };
    starterCount++;

    for (const f of files) {
      console.log(`    ${f.filename} (${f.language})`);
    }
    console.log(`    readme: ${readme ? "yes" : "no"}`);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`\nBundled ${starterCount} starters to ${OUTPUT_PATH}\n`);
}

main();
