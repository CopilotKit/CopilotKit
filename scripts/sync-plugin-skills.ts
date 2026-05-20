#!/usr/bin/env tsx
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// Report paths with forward slashes for cross-platform consistency.
const toPosix = (p: string) => p.split("\\").join("/");

export const RESERVED_LIFECYCLE_SLUGS: ReadonlySet<string> = new Set([
  "0-to-working-chat",
  "spa-without-runtime",
  "go-to-production",
  "scale-to-multi-agent",
  "v1-to-v2-migration",
  "debug-and-troubleshoot",
]);

// Version sync — plugin version tracks this package's version.
const VERSION_SOURCE_PACKAGE_JSON = "packages/runtime/package.json";
const PLUGIN_JSON = ".claude-plugin/plugin.json";
const MARKETPLACE_JSON = ".claude-plugin/marketplace.json";

export type SyncMode = "write" | "check";

export interface SyncOptions {
  cwd: string;
  mode: SyncMode;
}

export interface SyncResult {
  exitCode: 0 | 1 | 2;
  message: string;
  changed: string[];
  orphans: string[];
}

// ─── Source discovery ────────────────────────────────────────────────────────

interface PackageSkill {
  slug: string; // e.g. "runtime"
  sourceDir: string; // absolute path of packages/<pkg>/skills/<slug>
  mirrorDir: string; // absolute path of skills/<slug>
}

async function findPackageSkills(cwd: string): Promise<PackageSkill[]> {
  const packagesDir = join(cwd, "packages");
  if (!existsSync(packagesDir)) return [];

  const pkgs = await readdir(packagesDir, { withFileTypes: true });
  const out: PackageSkill[] = [];

  for (const pkg of pkgs) {
    if (!pkg.isDirectory()) continue;
    const skillsDir = join(packagesDir, pkg.name, "skills");
    if (!existsSync(skillsDir)) continue;
    const slugs = await readdir(skillsDir, { withFileTypes: true });
    for (const slug of slugs) {
      if (!slug.isDirectory()) continue;
      const sourceDir = join(skillsDir, slug.name);
      if (!existsSync(join(sourceDir, "SKILL.md"))) continue;
      out.push({
        slug: slug.name,
        sourceDir,
        mirrorDir: join(cwd, "skills", slug.name),
      });
    }
  }
  return out;
}

async function listFilesRec(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRec(full, base)));
    else if (e.isFile()) out.push(relative(base, full));
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function syncPluginSkills(opts: SyncOptions): Promise<SyncResult> {
  const skills = await findPackageSkills(opts.cwd);

  // Collision check.
  for (const s of skills) {
    if (RESERVED_LIFECYCLE_SLUGS.has(s.slug)) {
      return {
        exitCode: 2,
        message: `package skill slug "${s.slug}" collides with reserved lifecycle slug. Rename the package skill.`,
        changed: [],
        orphans: [],
      };
    }
  }

  const changed: string[] = [];
  const orphans: string[] = [];

  for (const s of skills) {
    const files = await listFilesRec(s.sourceDir);
    for (const relPath of files) {
      const srcPath = join(s.sourceDir, relPath);
      const dstPath = join(s.mirrorDir, relPath);
      const src = await readFile(srcPath);

      if (opts.mode === "check") {
        if (!existsSync(dstPath)) {
          changed.push(toPosix(join("skills", s.slug, relPath)));
          continue;
        }
        const dst = await readFile(dstPath);
        if (!src.equals(dst))
          changed.push(toPosix(join("skills", s.slug, relPath)));
      } else {
        await mkdir(dirname(dstPath), { recursive: true });
        await writeFile(dstPath, src);
      }
    }

    // Detect orphan files — files in mirror that are not in source.
    if (existsSync(s.mirrorDir)) {
      const mirrorFiles = await listFilesRec(s.mirrorDir);
      const sourceSet = new Set(files);
      for (const mf of mirrorFiles) {
        if (!sourceSet.has(mf))
          orphans.push(toPosix(join("skills", s.slug, mf)));
      }
    }
  }

  // Full-dir orphan scan — detect mirror skills directories whose source package
  // was removed entirely. The main loop cannot catch these because it only
  // iterates over currently discovered source skills.
  const mirrorRoot = join(opts.cwd, "skills");
  if (existsSync(mirrorRoot)) {
    const sourceSlugs = new Set(skills.map((s) => s.slug));
    const mirrorEntries = await readdir(mirrorRoot, { withFileTypes: true });
    for (const entry of mirrorEntries) {
      if (!entry.isDirectory()) continue;
      if (RESERVED_LIFECYCLE_SLUGS.has(entry.name)) continue;
      if (sourceSlugs.has(entry.name)) continue;
      // Orphan directory — source package was removed but mirror still has it.
      orphans.push(toPosix(join("skills", entry.name)));
    }
  }

  // Version sync — read runtime package version, write/check plugin + marketplace.
  const versionDrift = await handleVersionSync(opts);

  if (opts.mode === "check") {
    if (changed.length === 0 && orphans.length === 0 && !versionDrift) {
      return {
        exitCode: 0,
        message: "plugin skill mirror in sync",
        changed,
        orphans,
      };
    }
    const lines: string[] = [];
    if (changed.length) {
      lines.push(`drift detected in ${changed.length} file(s):`);
      lines.push(...changed.map((p) => `  ${p}`));
    }
    if (orphans.length) {
      lines.push(`orphan file(s) in mirror (source removed):`);
      lines.push(...orphans.map((p) => `  ${p}`));
    }
    if (versionDrift) {
      lines.push(`version drift: ${versionDrift}`);
    }
    lines.push("run: pnpm sync:plugin-skills");
    return { exitCode: 1, message: lines.join("\n"), changed, orphans };
  }

  // Write mode — also prune orphans so mirror is exactly the source.
  if (orphans.length) {
    const { rm } = await import("node:fs/promises");
    for (const o of orphans) {
      await rm(join(opts.cwd, o), { force: true, recursive: true });
    }
  }

  return {
    exitCode: 0,
    message: `synced ${skills.length} package skill(s)`,
    changed: [],
    orphans: [],
  };
}

// ─── Version sync helper ─────────────────────────────────────────────────────

// Returns a drift description string (for check mode), or empty string if in sync.
// In write mode, mutates the files and always returns empty string.
async function handleVersionSync(opts: SyncOptions): Promise<string> {
  const srcPath = join(opts.cwd, VERSION_SOURCE_PACKAGE_JSON);
  if (!existsSync(srcPath)) return "";
  const srcVersion: string = JSON.parse(
    await readFile(srcPath, "utf8"),
  ).version;

  const pluginPath = join(opts.cwd, PLUGIN_JSON);
  const marketPath = join(opts.cwd, MARKETPLACE_JSON);

  if (existsSync(pluginPath)) {
    const plugin = JSON.parse(await readFile(pluginPath, "utf8"));
    if (plugin.version !== srcVersion) {
      if (opts.mode === "check") {
        return `plugin.json version is "${plugin.version}", expected "${srcVersion}" (from ${VERSION_SOURCE_PACKAGE_JSON})`;
      }
      plugin.version = srcVersion;
      await writeFile(pluginPath, JSON.stringify(plugin, null, 2) + "\n");
    }
  }

  if (existsSync(marketPath)) {
    const market = JSON.parse(await readFile(marketPath, "utf8"));
    const marketVersion = market.plugins?.[0]?.version;
    if (marketVersion !== srcVersion) {
      if (opts.mode === "check") {
        return `marketplace.json plugins[0].version is "${marketVersion}", expected "${srcVersion}" (from ${VERSION_SOURCE_PACKAGE_JSON})`;
      }
      if (market.plugins?.[0]) {
        market.plugins[0].version = srcVersion;
        await writeFile(marketPath, JSON.stringify(market, null, 2) + "\n");
      }
    }
  }

  return "";
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode: SyncMode = process.argv.includes("--check") ? "check" : "write";
  const result = await syncPluginSkills({ cwd: process.cwd(), mode });
  if (result.message) console.log(result.message);
  process.exit(result.exitCode);
}

// Use import.meta detection so the file is testable without triggering the CLI path.
if (process.argv[1] && process.argv[1].endsWith("sync-plugin-skills.ts")) {
  void main();
}
