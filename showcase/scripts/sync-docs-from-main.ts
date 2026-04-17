/**
 * Sync docs from main CopilotKit docs to the showcase platform.
 *
 * Reads changed files from docs/content/docs/ and docs/snippets/,
 * applies structural transforms, and writes to showcase/shell/src/content/.
 *
 * Usage:
 *   npx tsx showcase/scripts/sync-docs-from-main.ts
 *   npx tsx showcase/scripts/sync-docs-from-main.ts --dry-run
 *   npx tsx showcase/scripts/sync-docs-from-main.ts --all  (sync all files, not just changed)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const MAIN_DOCS = path.join(ROOT, "docs/content/docs");
const MAIN_SNIPPETS = path.join(ROOT, "docs/snippets");
const SHOWCASE_DOCS = path.join(ROOT, "showcase/shell/src/content/docs");
const SHOWCASE_SNIPPETS = path.join(
  ROOT,
  "showcase/shell/src/content/snippets",
);
const SYNC_MARKER = path.join(ROOT, "showcase/shell/.docs-sync-sha");

// LangChain -> LangGraph exclusions (these intentionally keep "LangChain")
const LANGCHAIN_EXCLUSIONS = [
  "LangChain's tool call definitions",
  "LangChain tool call format",
  "langchain.agents",
  "langchain_core",
];

// ---------------------------------------------------------------------------
// Transform pipeline
// ---------------------------------------------------------------------------

/**
 * Strip all MDX-level import statements between frontmatter and first content.
 * Preserves imports inside code fences.
 */
function stripMdxImports(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inFrontmatter = false;
  let frontmatterClosed = false;
  let inCodeFence = false;
  let importSectionDone = false;
  let inMultiLineImport = false;

  for (const line of lines) {
    // Track frontmatter boundaries
    if (line.trim() === "---") {
      if (!inFrontmatter && !frontmatterClosed) {
        inFrontmatter = true;
        result.push(line);
        continue;
      } else if (inFrontmatter) {
        inFrontmatter = false;
        frontmatterClosed = true;
        result.push(line);
        continue;
      }
    }

    if (inFrontmatter) {
      result.push(line);
      continue;
    }

    // Track code fences
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }

    if (inCodeFence) {
      result.push(line);
      continue;
    }

    // After frontmatter, before first content: strip import lines
    if (frontmatterClosed && !importSectionDone) {
      // If we're inside a multi-line import, skip until closing line
      if (inMultiLineImport) {
        if (line.includes("} from") || line.trimStart().startsWith("from ")) {
          inMultiLineImport = false;
        }
        // Skip this line either way (it's part of the import)
        continue;
      }

      if (
        line.trim().startsWith("import ") ||
        line.trim().startsWith("import{")
      ) {
        // Check if this is a multi-line import (no `from` on same line)
        if (
          !line.includes(" from ") &&
          !line.includes(' from"') &&
          !line.includes(" from'")
        ) {
          inMultiLineImport = true;
        }
        // Skip this import line
        continue;
      }
      // Also skip blank lines in the import section
      if (line.trim() === "") {
        continue;
      }
      // First non-import, non-blank line: import section is done
      importSectionDone = true;
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Remove `components={props.components}` from component usage.
 */
function stripComponentsProps(content: string): string {
  return content.replace(/ components=\{props\.components\}/g, "");
}

/**
 * Replace "LangChain" with "LangGraph" in langgraph integration files,
 * respecting known exclusions and preserving code fence content.
 * Code blocks may contain legitimate `langchain` package references
 * that must not be renamed (validated by executable doc tests on main).
 */
function replaceLangChainWithLangGraph(
  content: string,
  filePath: string,
): string {
  // Only apply in langgraph integration directory
  if (!filePath.includes("integrations/langgraph")) {
    return content;
  }

  const lines = content.split("\n");
  const result: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    // Track code fences — never rename inside them
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }

    if (inCodeFence) {
      result.push(line);
      continue;
    }

    // Check if this line contains an exclusion
    const hasExclusion = LANGCHAIN_EXCLUSIONS.some((exc) => line.includes(exc));
    if (hasExclusion) {
      result.push(line);
    } else {
      result.push(line.replace(/LangChain/g, "LangGraph"));
    }
  }

  return result.join("\n");
}

/**
 * Apply the full transform pipeline to a file's content.
 */
function transformContent(content: string, filePath: string): string {
  let result = content;
  result = stripMdxImports(result);
  result = stripComponentsProps(result);
  result = replaceLangChainWithLangGraph(result, filePath);
  return result;
}

// ---------------------------------------------------------------------------
// Path mapping
// ---------------------------------------------------------------------------

/**
 * Map a main docs path to its showcase equivalent.
 * Strips the (root)/ directory prefix if present.
 */
function mainToShowcasePath(mainPath: string): string {
  // docs/content/docs/(root)/quickstart.mdx -> showcase/shell/src/content/docs/quickstart.mdx
  let rel = path.relative(MAIN_DOCS, mainPath);
  // Strip (root)/ prefix
  if (rel.startsWith("(root)/") || rel.startsWith("(root)\\")) {
    rel = rel.slice(7);
  }
  return path.join(SHOWCASE_DOCS, rel);
}

function mainSnippetToShowcasePath(mainPath: string): string {
  const rel = path.relative(MAIN_SNIPPETS, mainPath);
  return path.join(SHOWCASE_SNIPPETS, rel);
}

// ---------------------------------------------------------------------------
// Showcase-local modification detection
// ---------------------------------------------------------------------------

/**
 * Check if a showcase file has been locally modified beyond standard transforms.
 * Compares the current showcase file against a "clean transform" of the previous main version.
 */
function hasShowcaseLocalModifications(
  showcasePath: string,
  mainPath: string,
  lastSyncSha: string,
): boolean {
  if (!fs.existsSync(showcasePath)) {
    return false; // New file, no local mods
  }

  // Get the main file content at the last sync point
  try {
    const mainRelative = path.relative(ROOT, mainPath);
    const previousMainContent = execSync(
      `git show ${lastSyncSha}:${mainRelative}`,
      { encoding: "utf-8", cwd: ROOT },
    );
    const cleanTransform = transformContent(previousMainContent, showcasePath);
    const currentShowcase = fs.readFileSync(showcasePath, "utf-8");

    return cleanTransform.trim() !== currentShowcase.trim();
  } catch (err: unknown) {
    // File didn't exist at last sync — safe to overwrite
    if (err instanceof Error && "status" in err) {
      return false;
    }
    // Unexpected error — be conservative, flag for review
    console.warn(
      `[WARN] hasShowcaseLocalModifications failed for ${showcasePath}: ${err}`,
    );
    return true;
  }
}

// ---------------------------------------------------------------------------
// Diff detection
// ---------------------------------------------------------------------------

function getLastSyncSha(): string {
  if (fs.existsSync(SYNC_MARKER)) {
    return fs.readFileSync(SYNC_MARKER, "utf-8").trim();
  }
  // No marker: use a reasonable default (100 commits ago)
  try {
    return execSync("git rev-parse HEAD~100", {
      encoding: "utf-8",
      cwd: ROOT,
    }).trim();
  } catch {
    throw new Error(
      "Cannot determine sync baseline: HEAD~100 is unreachable (shallow clone?). " +
        "Run with --all to sync all files, or deepen the clone with `git fetch --unshallow`.",
    );
  }
}

function getChangedFiles(sinceSha: string): string[] {
  const output = execSync(
    `git diff --name-only ${sinceSha}..HEAD -- docs/content/docs/ docs/snippets/`,
    { encoding: "utf-8", cwd: ROOT },
  );
  return output.split("\n").filter((f) => f.trim() && f.endsWith(".mdx"));
}

function getAllFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".mdx")) {
        files.push(path.relative(ROOT, full));
      }
    }
  }

  walk(MAIN_DOCS);
  walk(MAIN_SNIPPETS);
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface SyncResult {
  copied: string[];
  transformed: string[];
  needsReview: string[];
  autoMerged: string[];
  mergeConflict: string[];
  skipped: string[];
  deleted: string[];
}

// ---------------------------------------------------------------------------
// 3-way merge for showcase-local modifications
// ---------------------------------------------------------------------------

/**
 * Attempt a 3-way merge for a file with showcase-local modifications.
 *
 * - base   = clean transform of main file at the last sync sha
 * - local  = current showcase file on disk
 * - remote = clean transform of main file at HEAD
 *
 * Returns { success: true, content } if `git merge-file` produced a clean
 * merge (exit 0, no conflict markers).
 *
 * Returns { success: false, content: upstreamTransformed } if merge produced
 * conflicts or failed to compute a base. Caller writes upstream-wins content
 * and flags the file for manual review in the PR body.
 */
function attemptThreeWayMerge(
  showcasePath: string,
  mainPath: string,
  lastSyncSha: string,
): { success: boolean; content: string } {
  const upstreamContent = fs.readFileSync(mainPath, "utf-8");
  const upstreamTransformed = transformContent(upstreamContent, showcasePath);

  if (!fs.existsSync(showcasePath)) {
    return { success: true, content: upstreamTransformed };
  }

  const localContent = fs.readFileSync(showcasePath, "utf-8");

  let baseContent: string;
  try {
    const mainRelative = path.relative(ROOT, mainPath);
    const previousMainContent = execSync(
      `git show ${lastSyncSha}:${mainRelative}`,
      { encoding: "utf-8", cwd: ROOT },
    );
    baseContent = transformContent(previousMainContent, showcasePath);
  } catch {
    // No base available — cannot 3-way merge safely
    return { success: false, content: upstreamTransformed };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-sync-"));
  const localFile = path.join(tmpDir, "local");
  const baseFile = path.join(tmpDir, "base");
  const remoteFile = path.join(tmpDir, "remote");
  try {
    fs.writeFileSync(localFile, localContent);
    fs.writeFileSync(baseFile, baseContent);
    fs.writeFileSync(remoteFile, upstreamTransformed);

    // `git merge-file` writes merged result in-place into `localFile`.
    // Exit code 0 = clean merge; >0 = number of conflicts remaining.
    let mergeExitCode = 0;
    try {
      execSync(
        `git merge-file -L showcase -L base -L upstream "${localFile}" "${baseFile}" "${remoteFile}"`,
        { stdio: "pipe" },
      );
    } catch (err: unknown) {
      if (err instanceof Error && "status" in err) {
        mergeExitCode = (err as { status: number }).status;
      } else {
        return { success: false, content: upstreamTransformed };
      }
    }

    if (mergeExitCode === 0) {
      const merged = fs.readFileSync(localFile, "utf-8");
      return { success: true, content: merged };
    }
    return { success: false, content: upstreamTransformed };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function parseArgs(): { dryRun: boolean; all: boolean } {
  return {
    dryRun: process.argv.includes("--dry-run"),
    all: process.argv.includes("--all"),
  };
}

function main(): SyncResult {
  const { dryRun, all } = parseArgs();
  const lastSyncSha = getLastSyncSha();
  const headSha = execSync("git rev-parse HEAD", {
    encoding: "utf-8",
    cwd: ROOT,
  }).trim();

  console.log("=== Docs Sync ===");
  console.log(`Last sync: ${lastSyncSha.slice(0, 8)}`);
  console.log(`Current HEAD: ${headSha.slice(0, 8)}`);
  if (dryRun) console.log("[DRY RUN]");

  // Get files to process
  const changedRelPaths = all ? getAllFiles() : getChangedFiles(lastSyncSha);
  console.log(`Files to process: ${changedRelPaths.length}`);

  const result: SyncResult = {
    copied: [],
    transformed: [],
    needsReview: [],
    autoMerged: [],
    mergeConflict: [],
    skipped: [],
    deleted: [],
  };

  for (const relPath of changedRelPaths) {
    const mainAbsolute = path.join(ROOT, relPath);
    const isSnippet = relPath.startsWith("docs/snippets/");
    const showcaseAbsolute = isSnippet
      ? mainSnippetToShowcasePath(mainAbsolute)
      : mainToShowcasePath(mainAbsolute);

    // File deleted on main
    if (!fs.existsSync(mainAbsolute)) {
      if (fs.existsSync(showcaseAbsolute)) {
        result.deleted.push(relPath);
        console.log(
          `  [DELETE?] ${relPath} (removed on main, exists in showcase)`,
        );
      }
      continue;
    }

    // Check for showcase-local modifications — attempt 3-way merge and
    // always produce file content. Clean merge = auto-applied; conflicting
    // merge = upstream-wins, flagged for human review in PR body.
    if (
      hasShowcaseLocalModifications(showcaseAbsolute, mainAbsolute, lastSyncSha)
    ) {
      result.needsReview.push(relPath);
      const merge = attemptThreeWayMerge(
        showcaseAbsolute,
        mainAbsolute,
        lastSyncSha,
      );

      // If the result is identical to what's already on disk, nothing to do.
      const existingContent = fs.existsSync(showcaseAbsolute)
        ? fs.readFileSync(showcaseAbsolute, "utf-8")
        : null;
      if (
        existingContent !== null &&
        existingContent.trim() === merge.content.trim()
      ) {
        result.skipped.push(relPath);
        if (merge.success) {
          console.log(
            `  [REVIEW/NOOP] ${relPath} (merged content matches existing)`,
          );
        } else {
          console.log(
            `  [REVIEW/NOOP] ${relPath} (upstream-wins content matches existing)`,
          );
        }
        continue;
      }

      if (!dryRun) {
        fs.mkdirSync(path.dirname(showcaseAbsolute), { recursive: true });
        fs.writeFileSync(showcaseAbsolute, merge.content);
      }

      if (merge.success) {
        result.autoMerged.push(relPath);
        console.log(`  [REVIEW/AUTO-MERGED] ${relPath} (3-way merge clean)`);
      } else {
        result.mergeConflict.push(relPath);
        console.log(
          `  [REVIEW/CONFLICT] ${relPath} (3-way merge failed; upstream wins — manual review required)`,
        );
      }
      continue;
    }

    // Read and transform
    const mainContent = fs.readFileSync(mainAbsolute, "utf-8");
    const transformed = transformContent(mainContent, showcaseAbsolute);

    // Check if transform changed anything
    const isIdentical = mainContent === transformed;

    // Check if showcase already has this content
    if (fs.existsSync(showcaseAbsolute)) {
      const existing = fs.readFileSync(showcaseAbsolute, "utf-8");
      if (existing.trim() === transformed.trim()) {
        result.skipped.push(relPath);
        continue; // Already up to date
      }
    }

    // Write
    if (!dryRun) {
      fs.mkdirSync(path.dirname(showcaseAbsolute), { recursive: true });
      fs.writeFileSync(showcaseAbsolute, transformed);
    }

    if (isIdentical) {
      result.copied.push(relPath);
      console.log(`  [COPY] ${relPath}`);
    } else {
      result.transformed.push(relPath);
      console.log(`  [TRANSFORM] ${relPath}`);
    }
  }

  // Update sync marker only when the merge is clean (no manual-review
  // conflicts left). If there are conflicts, keep the old sha so the next
  // run re-attempts the merge once a human has reconciled the conflict PR.
  if (
    !dryRun &&
    result.mergeConflict.length === 0 &&
    (result.copied.length > 0 ||
      result.transformed.length > 0 ||
      result.autoMerged.length > 0)
  ) {
    fs.writeFileSync(SYNC_MARKER, headSha + "\n");
  }

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Copied (identical): ${result.copied.length}`);
  console.log(`Transformed: ${result.transformed.length}`);
  console.log(`Auto-merged (3-way clean): ${result.autoMerged.length}`);
  console.log(
    `Merge conflict (upstream-wins, needs review): ${result.mergeConflict.length}`,
  );
  console.log(`Needs review (total): ${result.needsReview.length}`);
  console.log(`Skipped (up to date): ${result.skipped.length}`);
  console.log(`Deleted on main: ${result.deleted.length}`);

  if (result.autoMerged.length > 0) {
    console.log("\nFiles auto-merged (3-way clean):");
    for (const f of result.autoMerged) console.log(`  ${f}`);
  }
  if (result.mergeConflict.length > 0) {
    console.log(
      "\nFiles written with upstream-wins (merge conflict — manual review):",
    );
    for (const f of result.mergeConflict) console.log(`  ${f}`);
  }

  if (result.deleted.length > 0) {
    console.log("\nFiles deleted on main (not auto-deleted in showcase):");
    for (const f of result.deleted) {
      console.log(`  ${f}`);
    }
  }

  return result;
}

const result = main();

// Exit codes for CI:
//   0 = changes auto-applied (clean transforms / clean 3-way merges); safe to
//       push + auto-merge
//   2 = nothing changed
//   3 = has review items (either 3-way merge conflicts where upstream won,
//       or files deleted on main); CI opens a PR but does NOT auto-merge
const hasAutoApplied =
  result.copied.length > 0 ||
  result.transformed.length > 0 ||
  result.autoMerged.length > 0;
const hasReviewItems =
  result.mergeConflict.length > 0 || result.deleted.length > 0;

if (!hasAutoApplied && !hasReviewItems) {
  process.exit(2);
} else if (hasReviewItems) {
  // Write review items to a file for CI to include in PR body.
  // These files are already written to disk — CI will commit them and open
  // a PR flagged "needs review" (no auto-merge).
  const reviewLines: string[] = [];
  if (result.mergeConflict.length > 0) {
    reviewLines.push(
      "Files where 3-way merge FAILED — upstream content written as-is, local modifications overridden. Manual review REQUIRED before merging this PR:",
    );
    for (const f of result.mergeConflict) reviewLines.push(`  - ${f}`);
  }
  if (result.autoMerged.length > 0) {
    reviewLines.push("");
    reviewLines.push(
      "Files auto-merged via 3-way merge (clean, no conflict markers — still worth a glance):",
    );
    for (const f of result.autoMerged) reviewLines.push(`  - ${f}`);
  }
  if (result.deleted.length > 0) {
    reviewLines.push("");
    reviewLines.push(
      "Files deleted on main (review whether to delete in showcase):",
    );
    for (const f of result.deleted) reviewLines.push(`  - ${f}`);
  }
  fs.writeFileSync(
    path.join(ROOT, "review-items.txt"),
    reviewLines.join("\n") + "\n",
  );
  process.exit(3);
} else {
  process.exit(0);
}
