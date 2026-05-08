/**
 * Sync docs from main CopilotKit docs to the showcase platform.
 *
 * Reads changed files from docs/content/docs/ and docs/snippets/,
 * applies structural transforms, and writes to showcase/shell-docs/src/content/.
 *
 * Usage:
 *   npx tsx showcase/scripts/sync-docs-from-main.ts
 *   npx tsx showcase/scripts/sync-docs-from-main.ts --dry-run
 *   npx tsx showcase/scripts/sync-docs-from-main.ts --all  (sync all files, not just changed)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const MAIN_DOCS = path.join(ROOT, "docs/content/docs");
const MAIN_SNIPPETS = path.join(ROOT, "docs/snippets");
// MDX docs content moved from shell to shell-docs (which owns the docs
// hostname). Sync target updated in lockstep — all docs authoring/sync
// flows through shell-docs now.
const SHOWCASE_DOCS = path.join(ROOT, "showcase/shell-docs/src/content/docs");
const SHOWCASE_SNIPPETS = path.join(
  ROOT,
  "showcase/shell-docs/src/content/snippets",
);
const SYNC_MARKER = path.join(ROOT, "showcase/shell-docs/.docs-sync-sha");

// LangChain -> LangGraph exclusions (these intentionally keep "LangChain")
const LANGCHAIN_EXCLUSIONS = [
  "LangChain's tool call definitions",
  "LangChain tool call format",
  "langchain.agents",
  "langchain_core",
];

/**
 * Path patterns that should never be synced from upstream into shell-docs,
 * applied to relative paths (e.g. `docs/content/docs/integrations/mastra/(other)/...`).
 *
 * Per-framework files that exist only as one-line snippet stubs (`<Threads />`,
 * `<SelfHosting />`, etc.) are excluded here. Shell-docs renders the real
 * content at the root path via the same shared-snippet component, and the
 * framework-scoped router falls back to root MDX when no per-framework
 * override exists, so the stubs add nothing — they only cluttered the disk
 * and reappeared on every sync.
 *
 * Per-framework `(other)/` subtrees ship byte-duplicate `contributing/` +
 * `telemetry/` content across every framework; shell-docs owns the
 * canonical copy at root `(other)/`.
 *
 * The `/learn/` tree is retired in shell-docs (PRs #4494/#4496 promoted
 * the seven explanation pages into Concepts/Premium and the multi-
 * conversation tutorial into /tutorials/). All `/learn/*` URLs are
 * served via redirects in `next.config.ts`, and the physical files
 * must NOT be re-introduced by the sync script.
 *
 * The root `ag-ui-middleware.mdx` was moved to
 * `agentic-protocols/ag-ui-middleware.mdx` in PR #4496 (with a 302
 * redirect). The root path stays excluded so future syncs don't restore
 * the duplicate.
 *
 * The shared `mcp-server-setup.mdx` snippet is also excluded
 * (PDX-117 — https://linear.app/copilotkit/issue/PDX-117). Shell-docs
 * ships an enhanced version with HTTP/SSE transport Tabs, the
 * `mcp-remote` bridge, and a Tadata Callout; upstream still carries
 * the older single-`url` JSON shape, so syncing would regress the
 * shell-docs experience.
 *
 * Upstream keeps all of these copies — removing them there means touching
 * every parallel framework tree, which is upstream-IA work outside this
 * branch's scope. The exclusion is the durable shell-docs-only fix.
 */
const PATH_EXCLUSIONS: RegExp[] = [
  /^docs\/content\/docs\/integrations\/[^/]+\/\(other\)\//,
  /^docs\/content\/docs\/integrations\/[^/]+\/threads\.mdx$/,
  /^docs\/content\/docs\/integrations\/[^/]+\/premium\/self-hosting\.mdx$/,
  /^docs\/content\/docs\/learn\//,
  /^docs\/content\/docs\/\(root\)\/ag-ui-middleware\.mdx$/,
  /^docs\/snippets\/shared\/guides\/mcp-server-setup\.mdx$/,
  // PR #4494 dropped these stale workflow-execution / state-inputs-outputs
  // duplicates from shell-docs. Each shared-state meta.json wires only one
  // of the two files; the other was an orphan. Block the sync from
  // restoring them.
  /^docs\/content\/docs\/integrations\/langgraph\/shared-state\/workflow-execution\.mdx$/,
  /^docs\/content\/docs\/integrations\/adk\/shared-state\/(workflow-execution|state-inputs-outputs)\.mdx$/,
  /^docs\/content\/docs\/integrations\/llamaindex\/shared-state\/state-inputs-outputs\.mdx$/,
  // AgentCore content was inlined into the canonical
  // `deploy/agentcore.mdx` page (see PR #4514 follow-up). Block the
  // upstream 3-shell + shared-snippet sources from re-flowing in:
  // - the upstream root shell that delegates to `<Content />`
  // - the per-framework shells that delegate to `<Content framework="..." />`
  // - the 355-line shared snippet that powers them
  /^docs\/content\/docs\/\(root\)\/deploy\/agentcore\.mdx$/,
  /^docs\/content\/docs\/integrations\/[^/]+\/deploy-agentcore\.mdx$/,
  /^docs\/snippets\/integrations\/agentcore\//,
];

function isExcludedPath(relPath: string): boolean {
  return PATH_EXCLUSIONS.some((re) => re.test(relPath));
}

// ---------------------------------------------------------------------------
// Re-introduction detector
// ---------------------------------------------------------------------------

/**
 * Compute the set of paths that exist in showcase docs git history as
 * deletions but are NOT currently present in the working tree.
 *
 * Background: PATH_EXCLUSIONS is the durable mechanism for keeping retired
 * upstream paths out of shell-docs. But it requires whoever retires a page
 * to also remember to add the regex — and historically that step has been
 * missed (PR #4521 brought back /learn/* and the root ag-ui-middleware
 * duplicate that earlier PRs had deliberately removed).
 *
 * This detector is the safety net: if a sync run is about to create a file
 * at a path that previously existed and was deleted, surface it in the
 * "needs review" PR body so a human can confirm the re-introduction is
 * intentional. If it isn't, the fix is to add the upstream regex to
 * PATH_EXCLUSIONS and delete the file again — at which point this detector
 * picks it up on the next sync, the loop closes.
 *
 * Cached: `git log` over the docs tree is non-trivial; we run it once.
 */
let cachedHistoricallyDeleted: Set<string> | null = null;
function getHistoricallyDeletedShowcasePaths(): Set<string> {
  if (cachedHistoricallyDeleted !== null) return cachedHistoricallyDeleted;
  const result = new Set<string>();
  try {
    const out = execFileSync(
      "git",
      [
        "log",
        "--all",
        "--diff-filter=D",
        "--pretty=format:",
        "--name-only",
        "--",
        "showcase/shell-docs/src/content/docs/",
        "showcase/shell-docs/src/content/snippets/",
      ],
      { encoding: "utf-8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.endsWith(".mdx")) continue;
      // Only flag paths the working tree no longer carries — files that were
      // deleted and later re-created intentionally aren't re-introductions.
      if (!fs.existsSync(path.join(ROOT, trimmed))) {
        result.add(trimmed);
      }
    }
  } catch (err: unknown) {
    console.warn(
      `[WARN] could not compute historical deletions; re-intro detector disabled: ${err instanceof Error ? err.message : err}`,
    );
  }
  cachedHistoricallyDeleted = result;
  return result;
}

/**
 * `true` when this sync would write to a showcase path that previously
 * existed in shell-docs and was deleted. Caller flags for manual review.
 *
 * Returns `false` for files that currently exist in the worktree (those
 * are updates, not re-introductions) and for any path that has no record
 * of prior deletion in git history.
 */
function isReintroductionOfDeletedPath(showcaseAbsolutePath: string): boolean {
  if (fs.existsSync(showcaseAbsolutePath)) return false;
  const rel = path.relative(ROOT, showcaseAbsolutePath);
  return getHistoricallyDeletedShowcasePaths().has(rel);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize trailing-EOL + leading BOM for idempotency comparisons.
 *
 * - Strips a leading UTF-8 BOM (U+FEFF) that editors sometimes insert.
 * - Strips ALL trailing whitespace (including \r\n, extra blank lines,
 *   trailing spaces, tabs). Editors that re-save a file with an extra
 *   trailing newline or BOM should not trigger spurious rewrites.
 *
 * Intentional internal whitespace (inside the file body) is preserved —
 * only the edges are normalized.
 */
function stripTrailingEol(s: string): string {
  // Strip leading BOM if present.
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
  }
  // Strip all trailing whitespace (newlines, spaces, tabs, \r).
  return s.replace(/\s+$/, "");
}

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
  // docs/content/docs/(root)/quickstart.mdx -> showcase/shell-docs/src/content/docs/quickstart.mdx
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
    const previousMainContent = execFileSync(
      "git",
      ["show", `${lastSyncSha}:${mainRelative}`],
      { encoding: "utf-8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    const cleanTransform = transformContent(previousMainContent, showcasePath);
    const currentShowcase = fs.readFileSync(showcasePath, "utf-8");

    return (
      stripTrailingEol(cleanTransform) !== stripTrailingEol(currentShowcase)
    );
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
    return execFileSync("git", ["rev-parse", "HEAD~100"], {
      encoding: "utf-8",
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(
      "Cannot determine sync baseline: HEAD~100 is unreachable (shallow clone?). " +
        "Run with --all to sync all files, or deepen the clone with `git fetch --unshallow`.",
    );
  }
}

function getChangedFiles(sinceSha: string): string[] {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      `${sinceSha}..HEAD`,
      "--",
      "docs/content/docs/",
      "docs/snippets/",
    ],
    { encoding: "utf-8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  return output
    .split("\n")
    .filter((f) => f.trim() && f.endsWith(".mdx") && !isExcludedPath(f));
}

function getAllFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".mdx")) {
        const rel = path.relative(ROOT, full);
        if (!isExcludedPath(rel)) files.push(rel);
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

interface ConflictEntry {
  relPath: string;
  showcasePath: string;
  content: string;
}

interface SyncResult {
  copied: string[];
  transformed: string[];
  needsReview: string[];
  autoMerged: string[];
  mergeConflict: string[];
  skipped: string[];
  deleted: string[];
  reintroduced: string[];
  conflictManifest: ConflictEntry[];
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
    const previousMainContent = execFileSync(
      "git",
      ["show", `${lastSyncSha}:${mainRelative}`],
      { encoding: "utf-8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
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
    // Exit code 0 = clean merge; >0 = number of conflicts remaining; null =
    // killed by signal (treat as failure).
    let cleanMerge = false;
    try {
      execFileSync(
        "git",
        [
          "merge-file",
          "-L",
          "showcase",
          "-L",
          "base",
          "-L",
          "upstream",
          localFile,
          baseFile,
          remoteFile,
        ],
        { stdio: "pipe" },
      );
      cleanMerge = true;
    } catch (err: unknown) {
      // status === null means killed by signal — treat as failure, not clean.
      // status > 0 means N conflicts remaining — treat as failure.
      if (err instanceof Error && "status" in err) {
        const status = (err as { status: number | null }).status;
        if (status === null) {
          return { success: false, content: upstreamTransformed };
        }
        // conflicts remain; fall through to upstream-wins
      } else {
        return { success: false, content: upstreamTransformed };
      }
    }

    if (cleanMerge) {
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
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
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
    reintroduced: [],
    conflictManifest: [],
  };

  // Upstream-wins content for merge-conflict files. Not written to the
  // current worktree — workflow applies these to the PR branch only so
  // that future sync runs on main still detect local drift until the
  // needs-review PR is merged by a human.
  const conflictManifest: ConflictEntry[] = result.conflictManifest;

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
    // merge = upstream-wins CONTENT captured but NOT written to the current
    // worktree — workflow applies it to the PR branch only so that future
    // sync runs on main still detect the local drift until a human merges.
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
        stripTrailingEol(existingContent) === stripTrailingEol(merge.content)
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

      if (merge.success) {
        // Clean 3-way merge: safe to write to the worktree; it reflects an
        // auto-applied resolution of both local + upstream changes.
        if (!dryRun) {
          fs.mkdirSync(path.dirname(showcaseAbsolute), { recursive: true });
          fs.writeFileSync(showcaseAbsolute, merge.content);
        }
        result.autoMerged.push(relPath);
        console.log(`  [REVIEW/AUTO-MERGED] ${relPath} (3-way merge clean)`);
      } else {
        // Conflict: DO NOT write upstream-wins to the current worktree.
        // Record into a manifest — the workflow applies these files to the
        // PR branch only. Leaving the worktree untouched preserves the
        // invariant that future sync runs on main still flag this file for
        // review until a human merges the needs-review PR.
        conflictManifest.push({
          relPath,
          showcasePath: path.relative(ROOT, showcaseAbsolute),
          content: merge.content,
        });
        result.mergeConflict.push(relPath);
        console.log(
          `  [REVIEW/CONFLICT] ${relPath} (3-way merge failed; upstream-wins content staged to manifest — manual review required)`,
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
      if (stripTrailingEol(existing) === stripTrailingEol(transformed)) {
        result.skipped.push(relPath);
        continue; // Already up to date
      }
    }

    // Detect re-introduction of a previously-deleted showcase path BEFORE
    // writing — fs.existsSync would flip to true after the write. The check
    // is informational; we still write the file so the sync stays in flow,
    // but we flag the path for manual review (and force the PR off the
    // auto-merge path via exit 3).
    const isReintro = isReintroductionOfDeletedPath(showcaseAbsolute);

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

    if (isReintro) {
      result.reintroduced.push(relPath);
      console.log(
        `  [REVIEW/REINTRODUCED] ${relPath} → ${path.relative(ROOT, showcaseAbsolute)} (previously deleted in shell-docs; verify intent)`,
      );
    }
  }

  // Update sync marker whenever all files were successfully resolved:
  // clean transforms, clean auto-merges, or no changes at all. A successful
  // 3-way auto-merge means the file IS resolved — its content on disk
  // reflects the merged state, so the next run should treat HEAD as the
  // new base. Only outstanding merge conflicts (upstream-wins written to
  // PR branch only) or deletions (not auto-applied) keep the old sha so
  // future runs still flag them until a human merges the needs-review PR.
  if (
    !dryRun &&
    result.mergeConflict.length === 0 &&
    result.deleted.length === 0 &&
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
  console.log(
    `Re-introduced from deletion history (review required): ${result.reintroduced.length}`,
  );

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

  if (result.reintroduced.length > 0) {
    console.log(
      "\nFiles re-introduced from shell-docs deletion history (verify intent before merging):",
    );
    for (const f of result.reintroduced) {
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
// Only files that still need human attention force push_and_pr:
// - mergeConflict: 3-way merge failed, upstream-wins content staged to PR
//   branch, human must reconcile
// - deleted: files gone on main, not auto-deleted in showcase, human decides
// - reintroduced: sync wrote to a path previously deleted in shell-docs;
//   human confirms the re-introduction is intentional or adds the upstream
//   regex to PATH_EXCLUSIONS
// Auto-merged files (clean 3-way merge) are considered RESOLVED — they go
// through the auto_push fast path and the marker advances. `needsReview`
// is the superset tracker (local-mods detected pre-merge) and is NOT a
// gating condition on its own.
const hasReviewItems =
  result.mergeConflict.length > 0 ||
  result.deleted.length > 0 ||
  result.reintroduced.length > 0;

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
  if (result.reintroduced.length > 0) {
    reviewLines.push("");
    reviewLines.push(
      "Files re-introduced from shell-docs deletion history — these paths previously existed and were intentionally removed. Confirm the re-introduction is wanted; if not, add a PATH_EXCLUSIONS regex in showcase/scripts/sync-docs-from-main.ts and delete the file again:",
    );
    for (const f of result.reintroduced) reviewLines.push(`  - ${f}`);
  }
  // Write manifest + review items at the invocation cwd (the repo root
  // when run from CI, matching the workflow's `[ -f conflict-manifest.json ]`
  // and `cat review-items.txt` checks). Using process.cwd() rather than
  // ROOT makes the contract explicit: whoever invokes the script picks
  // where these artifacts land, and the workflow invokes from repo root.
  const artifactDir = process.cwd();
  const reviewItemsPath = path.join(artifactDir, "review-items.txt");
  fs.writeFileSync(reviewItemsPath, reviewLines.join("\n") + "\n");
  // Emit the absolute path to GITHUB_OUTPUT so the workflow's PR-body and
  // Slack payload steps can read the file without hardcoding a location.
  // (Downstream steps use `steps.sync.outputs.review_items_file`.) Skipped
  // outside CI — process.env.GITHUB_OUTPUT is unset for local runs.
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `review_items_file=${reviewItemsPath}\n`,
    );
  }
  // Persist the conflict manifest so the workflow can apply upstream-wins
  // content to the PR branch (NOT the current worktree — see
  // conflictManifest comment above).
  if (result.conflictManifest.length > 0) {
    fs.writeFileSync(
      path.join(artifactDir, "conflict-manifest.json"),
      JSON.stringify(result.conflictManifest, null, 2) + "\n",
    );
  }
  process.exit(3);
} else {
  process.exit(0);
}
