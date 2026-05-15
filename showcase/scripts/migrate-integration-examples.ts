// Migration Script: examples/integrations → showcase/integrations
//
// Copies agent code from existing examples/integrations/<name>/
// into the corresponding showcase/integrations/<slug>/src/agents/
//
// Usage (standalone):
//   npx tsx showcase/scripts/migrate-integration-examples.ts [--dry-run] [--redo]
//   npx tsx showcase/scripts/migrate-integration-examples.ts --integration mastra
//
// Usage (from create-integration):
//   import { migrateForSlug } from "./migrate-integration-examples.ts";
//   const result = migrateForSlug("mastra", { redo: false });

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXAMPLES_DIR = path.join(REPO_ROOT, "examples", "integrations");
const PACKAGES_DIR = path.join(__dirname, "..", "integrations");

// Map from examples/integrations dir name → showcase package slug
const SLUG_MAP: Record<string, string> = {
  "langgraph-python": "langgraph-python",
  "langgraph-js": "langgraph-typescript",
  "langgraph-fastapi": "langgraph-fastapi",
  mastra: "mastra",
  "crewai-crews": "crewai",
  "crewai-flows": "crewai",
  "pydantic-ai": "pydanticai",
  agno: "agno",
  llamaindex: "llamaindex",
  adk: "google-adk",
  "ms-agent-framework-dotnet": "maf-dotnet",
  "ms-agent-framework-python": "maf-python",
  "strands-python": "aws-strands",
  "agent-spec": "agent-spec-langgraph",
  "a2a-a2ui": "a2a",
  "a2a-middleware": "a2a",
  "mcp-apps": "mcp-apps",
};

// Reverse map: slug → example dir name(s)
const REVERSE_MAP: Record<string, string[]> = {};
for (const [example, slug] of Object.entries(SLUG_MAP)) {
  if (!REVERSE_MAP[slug]) REVERSE_MAP[slug] = [];
  REVERSE_MAP[slug].push(example);
}

export interface MigrationResult {
  example: string;
  slug: string;
  files: string[];
  skipped: string[];
  errors: string[];
  alreadyMigrated: boolean;
}

function findAgentFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string, rel: string) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (
          [
            "node_modules",
            ".next",
            "__pycache__",
            ".venv",
            ".git",
            "dist",
          ].includes(entry.name)
        )
          continue;
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        if (
          entry.name.endsWith(".py") ||
          (entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".d.ts") &&
            !entry.name.endsWith(".spec.ts") &&
            !entry.name.endsWith(".test.ts"))
        ) {
          results.push(relPath);
        }
      }
    }
  }
  walk(dir, "");
  return results;
}

function checkAlreadyMigrated(packageDir: string): boolean {
  // Check multiple locations where migrated files could land
  const dirs = [
    path.join(packageDir, "src", "agents"),
    path.join(packageDir, "src", "mastra"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = findAgentFiles(dir);
    if (files.some((f) => !f.endsWith("__init__.py") && !f.includes("TODO")))
      return true;
  }
  return false;
}

function wipeAgents(packageDir: string) {
  for (const dir of ["src/agents", "src/mastra"]) {
    const full = path.join(packageDir, dir);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
      fs.mkdirSync(full, { recursive: true });
    }
  }
}

function migrateIntegration(
  exampleName: string,
  opts: { dryRun?: boolean; redo?: boolean } = {},
): MigrationResult {
  const slug = SLUG_MAP[exampleName];
  const result: MigrationResult = {
    example: exampleName,
    slug: slug || "UNMAPPED",
    files: [],
    skipped: [],
    errors: [],
    alreadyMigrated: false,
  };

  if (!slug) {
    result.errors.push(`No slug mapping for "${exampleName}"`);
    return result;
  }

  const exampleDir = path.join(EXAMPLES_DIR, exampleName);
  const packageDir = path.join(PACKAGES_DIR, slug);

  if (!fs.existsSync(exampleDir)) {
    result.skipped.push(`Example dir not found: ${exampleDir}`);
    return result;
  }

  if (!fs.existsSync(packageDir)) {
    result.skipped.push(
      `Package dir doesn't exist: showcase/integrations/${slug}/`,
    );
    return result;
  }

  // Check if already migrated
  if (checkAlreadyMigrated(packageDir)) {
    result.alreadyMigrated = true;
    if (!opts.redo) {
      result.skipped.push("Already migrated (use --redo to re-import)");
      return result;
    }
    // Redo: wipe and re-import
    if (!opts.dryRun) {
      wipeAgents(packageDir);
      console.log(`    Wiped existing agents for redo`);
    }
  }

  // Find agent files
  const agentDirs = [
    path.join(exampleDir, "apps", "agent"),
    path.join(exampleDir, "agent"),
    exampleDir,
  ];

  const agentFiles: string[] = [];
  let sourceDir = exampleDir;
  for (const dir of agentDirs) {
    if (fs.existsSync(dir)) {
      const found = findAgentFiles(dir);
      if (found.length > 0) {
        agentFiles.push(...found);
        sourceDir = dir;
        break;
      }
    }
  }

  if (agentFiles.length === 0) {
    result.skipped.push("No agent files found in example");
    return result;
  }

  for (const file of agentFiles) {
    const sourcePath = path.join(sourceDir, file);

    // Smart placement: if the file path matches the package structure,
    // place it there directly. Otherwise, put it in src/agents/.
    let targetPath: string;
    if (
      file.startsWith("src/app/") ||
      file.startsWith("src/lib/") ||
      file.startsWith("src/mastra/") ||
      file.startsWith("src/agents/")
    ) {
      targetPath = path.join(packageDir, file);
    } else {
      targetPath = path.join(packageDir, "src", "agents", file);
    }

    if (opts.dryRun) {
      result.files.push(`[dry-run] ${file}`);
      continue;
    }

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      result.files.push(file);
    } catch (e: any) {
      result.errors.push(`Failed to copy ${file}: ${e.message}`);
    }
  }

  return result;
}

// Public API for use from create-integration
export function migrateForSlug(
  slug: string,
  opts: { dryRun?: boolean; redo?: boolean } = {},
): MigrationResult {
  const exampleNames = REVERSE_MAP[slug];
  if (!exampleNames || exampleNames.length === 0) {
    return {
      example: "none",
      slug,
      files: [],
      skipped: [`No example mapping for slug "${slug}" — nothing to migrate`],
      errors: [],
      alreadyMigrated: false,
    };
  }

  // Migrate the first matching example (most have only one)
  return migrateIntegration(exampleNames[0], opts);
}

// CLI entrypoint
function main() {
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes("--dry-run");
  const REDO = args.includes("--redo");
  const singleIdx = args.indexOf("--integration");
  const singleName = singleIdx >= 0 ? args[singleIdx + 1] : null;

  console.log("Migration: examples/integrations → showcase/integrations\n");
  if (DRY_RUN) console.log("DRY RUN — no files will be copied\n");
  if (REDO) console.log("REDO MODE — will wipe and re-import\n");

  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`Examples directory not found: ${EXAMPLES_DIR}`);
    process.exit(1);
  }

  const examples = singleName
    ? [singleName]
    : fs
        .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  const results: MigrationResult[] = [];
  let hasErrors = false;

  for (const example of examples) {
    const result = migrateIntegration(example, { dryRun: DRY_RUN, redo: REDO });
    results.push(result);

    const status =
      result.errors.length > 0
        ? "ERROR"
        : result.alreadyMigrated && !REDO
          ? "ALREADY"
          : result.skipped.length > 0
            ? "SKIP"
            : "OK";

    if (result.errors.length > 0) hasErrors = true;

    console.log(
      `  [${status}] ${example} → ${result.slug} (${result.files.length} files)`,
    );
    for (const err of result.errors) console.log(`         ERROR: ${err}`);
    for (const skip of result.skipped) console.log(`         SKIP: ${skip}`);
  }

  console.log("\n--- Summary ---");
  console.log(`Total: ${results.length}`);
  console.log(`Migrated: ${results.filter((r) => r.files.length > 0).length}`);
  console.log(
    `Already done: ${results.filter((r) => r.alreadyMigrated && r.skipped.length > 0).length}`,
  );
  console.log(
    `Skipped: ${results.filter((r) => !r.alreadyMigrated && r.skipped.length > 0).length}`,
  );
  console.log(`Errors: ${results.filter((r) => r.errors.length > 0).length}`);

  process.exit(hasErrors ? 1 : 0);
}

// Only run main if this is the entry point (not imported)
const isMain = process.argv[1]?.includes("migrate-integration-examples");
if (isMain) main();
