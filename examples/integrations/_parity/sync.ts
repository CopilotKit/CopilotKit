/**
 * Integration-demo parity sync.
 *
 * Copies verbatim files from the north-star integration demo to one or more
 * instance demos, and rewrites tracked package.json keys so scripts and
 * dependency pins stay aligned. Does NOT touch agent code or the api route —
 * those are the manual-merge zones per `_parity/manifest.json`.
 *
 * Usage (from repo root or anywhere):
 *   pnpm tsx examples/integrations/_parity/sync.ts --target=langgraph-js
 *   pnpm tsx examples/integrations/_parity/sync.ts --target=langgraph-js --dry-run
 *   pnpm tsx examples/integrations/_parity/sync.ts --all
 *
 * Exit codes:
 *   0 — sync applied (or dry-run reported only)
 *   1 — unexpected error (missing source file, unwritable target)
 *   2 — invalid CLI input
 */

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParityRoot } from "./lib/manifest.js";
import {
  loadManifest,
  instanceDir,
  northStarDir,
  listInstances,
} from "./lib/manifest.js";
import { fileExists, getByPath, setByPath } from "./lib/diff.js";

interface CliOpts {
  target?: string;
  all: boolean;
  dryRun: boolean;
}

function parseCli(argv: string[]): CliOpts {
  const opts: CliOpts = { all: false, dryRun: false };
  for (const arg of argv) {
    if (arg === "--all") opts.all = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--target="))
      opts.target = arg.slice("--target=".length);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      process.stderr.write(`unknown arg: ${arg}\n`);
      printHelp();
      process.exit(2);
    }
  }
  if (!opts.all && !opts.target) {
    process.stderr.write("required: --target=<name> or --all\n");
    printHelp();
    process.exit(2);
  }
  return opts;
}

function printHelp(): void {
  process.stderr.write(
    [
      "sync integration demos to north-star.",
      "",
      "  --target=<name>   sync a single instance (e.g. langgraph-js)",
      "  --all             sync every non-north-star instance",
      "  --dry-run         print changes without writing",
      "",
    ].join("\n"),
  );
}

function resolveParityDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

interface SyncResult {
  instance: string;
  filesCopied: number;
  filesSkipped: number;
  pkgKeysRewritten: string[];
}

function syncInstance(
  root: ParityRoot,
  instance: string,
  dryRun: boolean,
): SyncResult {
  const manifest = root.manifest;
  const from = northStarDir(root);
  const to = instanceDir(root, instance);
  const inst = manifest.instances[instance]!;

  if (!fileExists(to)) {
    throw new Error(`target directory missing: ${to}`);
  }

  let filesCopied = 0;
  let filesSkipped = 0;

  for (const pattern of manifest.tracked.verbatimFiles) {
    const matches = expandPattern(from, pattern);
    if (matches.length === 0) {
      process.stderr.write(
        `[parity] warn: verbatim pattern matched nothing in north-star: ${pattern}\n`,
      );
      continue;
    }
    for (const relPath of matches) {
      const src = join(from, relPath);
      const dst = join(to, relPath);
      if (isAllowedDivergence(relPath, inst.allowedDivergence)) {
        filesSkipped++;
        continue;
      }
      const changed = copyIfChanged(src, dst, dryRun);
      if (changed) filesCopied++;
    }
  }

  // Canonical prompt: not copied as a file. Each agent inlines the prompt
  // string in source. sync.ts used to write PROMPT.md per instance, but that
  // file was never loaded at runtime — it was cosmetic. Verifier now
  // grep-checks the canonical prompt's first line against instance source.

  // package.json key rewrite
  const pkgSrcPath = join(from, "package.json");
  const pkgDstPath = join(to, "package.json");
  const pkgSrc = JSON.parse(readFileSync(pkgSrcPath, "utf8")) as Record<
    string,
    unknown
  >;
  const pkgDst = JSON.parse(readFileSync(pkgDstPath, "utf8")) as Record<
    string,
    unknown
  >;
  const rewritten: string[] = [];

  for (const keyPath of manifest.tracked.packageJsonPaths) {
    const override = inst.packageJsonOverrides[keyPath];
    const value =
      override !== undefined ? override : getByPath(pkgSrc, keyPath);
    if (value === undefined) continue; // source doesn't declare it — leave instance alone
    const existing = getByPath(pkgDst, keyPath);
    if (existing !== value) {
      setByPath(pkgDst, keyPath, value);
      rewritten.push(keyPath);
    }
  }

  // Apply any override keys the source doesn't have (e.g. dev:agent differs
  // across instances and is NOT in packageJsonPaths)
  for (const [keyPath, override] of Object.entries(inst.packageJsonOverrides)) {
    if (manifest.tracked.packageJsonPaths.includes(keyPath)) continue;
    const existing = getByPath(pkgDst, keyPath);
    if (existing !== override) {
      setByPath(pkgDst, keyPath, override);
      rewritten.push(keyPath);
    }
  }

  if (rewritten.length > 0 && !dryRun) {
    writeFileSync(pkgDstPath, JSON.stringify(pkgDst, null, 2) + "\n");
  }

  return {
    instance,
    filesCopied,
    filesSkipped,
    pkgKeysRewritten: rewritten,
  };
}

function copyIfChanged(src: string, dst: string, dryRun: boolean): boolean {
  if (!fileExists(src)) {
    throw new Error(`missing source: ${src}`);
  }
  const srcBuf = readFileSync(src);
  if (fileExists(dst)) {
    const dstBuf = readFileSync(dst);
    if (srcBuf.equals(dstBuf)) return false;
  }
  if (dryRun) return true;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  return true;
}

/**
 * Minimal glob expansion. Supports literal paths, `dir/**` (recursive), and
 * `dir/**\/*.ext` (recursive with extension). Intentionally NOT a full glob —
 * manifest patterns are curated, not user input.
 */
export function expandPattern(baseDir: string, pattern: string): string[] {
  if (!pattern.includes("*")) {
    return fileExists(join(baseDir, pattern)) ? [pattern] : [];
  }
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return walk(baseDir, prefix).map((p) => p);
  }
  const doubleStarExt = pattern.match(/^(.+)\/\*\*\/\*\.([a-zA-Z0-9]+)$/);
  if (doubleStarExt) {
    const prefix = doubleStarExt[1]!;
    const ext = doubleStarExt[2]!;
    return walk(baseDir, prefix).filter((p) => p.endsWith(`.${ext}`));
  }
  throw new Error(`unsupported pattern: ${pattern}`);
}

function walk(baseDir: string, rel: string): string[] {
  const full = join(baseDir, rel);
  if (!fileExists(full)) return [];
  const out: string[] = [];
  const stack = [full];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const abs = join(dir, entry);
      const st = statSync(abs);
      if (st.isDirectory()) stack.push(abs);
      else out.push(relative(baseDir, abs));
    }
  }
  return out;
}

function isAllowedDivergence(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (relPath === prefix || relPath.startsWith(prefix + "/")) return true;
    } else if (pattern === relPath) {
      return true;
    }
  }
  return false;
}

function printSyncResult(r: SyncResult, dryRun: boolean): void {
  const verb = dryRun ? "would sync" : "synced";
  process.stdout.write(`\n${r.instance}: ${verb}\n`);
  process.stdout.write(`  files copied:    ${r.filesCopied}\n`);
  process.stdout.write(
    `  files skipped:   ${r.filesSkipped} (allowed divergence)\n`,
  );
  process.stdout.write(
    `  package.json:    ${r.pkgKeysRewritten.length} key(s) rewritten\n`,
  );
  if (r.pkgKeysRewritten.length > 0) {
    for (const k of r.pkgKeysRewritten) {
      process.stdout.write(`      - ${k}\n`);
    }
  }
}

function main(): void {
  const opts = parseCli(process.argv.slice(2));
  const parityDir = resolveParityDir();
  const root = loadManifest(parityDir);

  const targets = opts.all
    ? listInstances(root)
    : opts.target
      ? [opts.target]
      : [];

  if (opts.target && !root.manifest.instances[opts.target]) {
    process.stderr.write(`unknown instance: ${opts.target}\n`);
    process.stderr.write(
      `known: ${Object.keys(root.manifest.instances).join(", ")}\n`,
    );
    process.exit(2);
  }

  let totalFiles = 0;
  let totalKeys = 0;
  for (const t of targets) {
    if (t === root.manifest.northStar) continue; // paranoia: never write to north-star
    const result = syncInstance(root, t, opts.dryRun);
    printSyncResult(result, opts.dryRun);
    totalFiles += result.filesCopied;
    totalKeys += result.pkgKeysRewritten.length;
  }

  const mode = opts.dryRun ? "(dry-run) " : "";
  process.stdout.write(
    `\n${mode}total: ${totalFiles} file change(s), ${totalKeys} package.json key(s) across ${targets.length} instance(s)\n`,
  );
  process.stdout.write(
    `\nmanual-merge reminder: agent/ dir and api/copilotkit route are NOT synced.\n` +
      `run \`pnpm parity:verify\` to check agent-surface and prompt alignment.\n`,
  );
}

// Only run main() when invoked as script, not when imported by tests.
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`[parity] sync failed: ${(e as Error).message}\n`);
    process.exit(1);
  }
}
