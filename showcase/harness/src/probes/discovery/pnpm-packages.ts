import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { DiscoveryContext, DiscoverySource } from "../types.js";
import {
  DiscoverySourceNotFoundError,
  DiscoverySourceSchemaError,
} from "./errors.js";

/**
 * Discovery source: enumerate workspace packages from `pnpm-workspace.yaml`
 * + each matched directory's `package.json` / `pyproject.toml`.
 *
 * Pure filesystem — NEVER shells out to `pnpm` or invokes a child process.
 * Rationale: this runs inside the probe tick at cron cadence, and a shell
 * call at every tick would (a) add a pnpm binary dependency to the runtime
 * image, (b) bog down the scheduler with stderr collection, and (c) make
 * the source untestable without a full pnpm install in fixtures. Directly
 * parsing the YAML + manifests is both faster and fully hermetic.
 *
 * Glob semantics: only handles the shapes pnpm-workspace.yaml actually uses
 * in this repo — simple literals (`showcase/harness`), `*` wildcards
 * (`packages/*`), and negation (`!examples/v1/_legacy`). Does NOT implement
 * arbitrary brace-expansion / `**` recursion — if a future workspace pattern
 * needs those, add them with a paired test. A partial matcher that silently
 * under-enumerates would be worse than the current strict subset.
 *
 * Output shape: one record per discovered package. `ecosystem` is derived
 * from which manifest exists — `package.json` → npm, `pyproject.toml` →
 * pypi. Directories with BOTH emit two records (rare in this repo, but
 * supported cleanly for polyglot packages).
 */

export interface PnpmPackageRecord {
  /** Normalized package name. For npm: the `name` field; for pypi: `[project].name` or `[tool.poetry].name`. */
  name: string;
  /** Pinned version from manifest. `0.0.0` private packages still emit — the driver filters on its own axis. */
  pinnedVersion: string;
  /** `npm` or `pypi` — tells the driver which registry to query. */
  ecosystem: "npm" | "pypi";
  /** Workspace-relative directory the manifest was found in (e.g. "packages/runtime"). Useful for pathPrefix filtering + debugging. */
  path: string;
}

/**
 * Config / filter options recognized by the pnpm-packages source. All
 * optional; validated as `strict()` so a typo in the probe YAML surfaces
 * as a load-time Zod rejection rather than a silent "filter did nothing".
 */
const pnpmPackagesFilterSchema = z
  .object({
    ecosystem: z.enum(["npm", "pypi"]).optional(),
    pathPrefix: z.string().optional(),
    /**
     * Override the root directory that `pnpm-workspace.yaml` lives in.
     * Tests pass a fixture path; production callers rely on the default
     * ("/app" — set via the probe-invoker's env / a paired env var, see
     * the Dockerfile COPY for the runtime layout). Without an override
     * the source reads `process.cwd()`.
     */
    rootDir: z.string().optional(),
  })
  .strict();

type PnpmPackagesFilter = z.infer<typeof pnpmPackagesFilterSchema>;

export const pnpmPackagesDiscoverySource: DiscoverySource<PnpmPackageRecord> = {
  name: "pnpm-packages",
  configSchema: pnpmPackagesFilterSchema,
  async enumerate(
    ctx: DiscoveryContext,
    config: unknown,
  ): Promise<PnpmPackageRecord[]> {
    const filter = pnpmPackagesFilterSchema.parse(config ?? {});
    const rootDir = filter.rootDir ?? process.cwd();
    const workspacePath = path.join(rootDir, "pnpm-workspace.yaml");

    const patterns = await readWorkspacePatterns(workspacePath);
    const matchedDirs = await expandPatterns(rootDir, patterns);

    const records: PnpmPackageRecord[] = [];
    for (const relDir of matchedDirs) {
      const absDir = path.join(rootDir, relDir);
      // npm: package.json is the canonical indicator. A directory listed
      // in pnpm-workspace.yaml without a package.json is legal (an empty
      // glob match during a refactor) — skip rather than throw.
      const npmRec = await readNpmManifest(absDir, relDir);
      if (npmRec) records.push(npmRec);
      // pypi: pyproject.toml. Same skip-on-absence semantics.
      const pyRec = await readPyprojectManifest(absDir, relDir);
      if (pyRec) records.push(pyRec);
    }

    const filtered = records.filter((r) => {
      if (filter.ecosystem && r.ecosystem !== filter.ecosystem) return false;
      if (filter.pathPrefix && !r.path.startsWith(filter.pathPrefix))
        return false;
      return true;
    });

    ctx.logger.debug("discovery.pnpm-packages.enumerated", {
      rootDir,
      total: records.length,
      afterFilter: filtered.length,
      ecosystemFilter: filter.ecosystem ?? null,
      pathPrefix: filter.pathPrefix ?? null,
    });

    return filtered;
  },
};

async function readWorkspacePatterns(workspacePath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(workspacePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new DiscoverySourceNotFoundError(
        "pnpm-packages",
        "pnpm-workspace.yaml not found",
        workspacePath,
      );
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      `pnpm-workspace.yaml failed to parse: ${msg}`,
      workspacePath,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      "pnpm-workspace.yaml is not an object",
      workspacePath,
    );
  }
  const pkgs = (parsed as Record<string, unknown>).packages;
  if (!Array.isArray(pkgs)) {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      "pnpm-workspace.yaml missing `packages:` array",
      workspacePath,
    );
  }
  for (const entry of pkgs) {
    if (typeof entry !== "string") {
      throw new DiscoverySourceSchemaError(
        "pnpm-packages",
        "pnpm-workspace.yaml `packages:` must be strings",
        workspacePath,
      );
    }
  }
  return pkgs as string[];
}

/**
 * Expand a list of pnpm-workspace patterns into workspace-relative dirs.
 * Supports: literal paths, `<prefix>/*`, and leading-`!` negation.
 * Does NOT support `**` or brace expansion (see class-level JSDoc).
 */
async function expandPatterns(
  rootDir: string,
  patterns: string[],
): Promise<string[]> {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const p of patterns) {
    if (p.startsWith("!")) exclude.push(p.slice(1));
    else include.push(p);
  }
  const dirs = new Set<string>();
  for (const pattern of include) {
    for (const d of await matchPattern(rootDir, pattern)) {
      dirs.add(d);
    }
  }
  for (const pattern of exclude) {
    for (const d of await matchPattern(rootDir, pattern)) {
      dirs.delete(d);
    }
  }
  return [...dirs].sort();
}

async function matchPattern(
  rootDir: string,
  pattern: string,
): Promise<string[]> {
  // Literal (no wildcards): accept iff the directory exists. Avoid fs.stat
  // returning a file-shape match by checking isDirectory().
  if (!pattern.includes("*")) {
    const abs = path.join(rootDir, pattern);
    try {
      const stat = await fs.stat(abs);
      return stat.isDirectory() ? [pattern] : [];
    } catch {
      return [];
    }
  }
  // Trailing `*` wildcard: `<prefix>/*` — list the prefix dir and return
  // each sub-directory. We intentionally do NOT implement `**`, brace
  // expansion, or `<prefix>/*<suffix>` — this repo's pnpm-workspace.yaml
  // only uses trailing-`*` and literal patterns (see pnpm-workspace.yaml
  // line-by-line). Extending the matcher beyond that would add untested
  // code paths; the load-time SchemaError below flags unsupported
  // patterns so operators see a clear boot-time failure instead of a
  // silent under-enumeration.
  const starIdx = pattern.indexOf("*");
  const afterStar = pattern.slice(starIdx + 1);
  if (afterStar !== "" && afterStar !== "/") {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      `unsupported pnpm-workspace glob pattern: "${pattern}" — only literals and trailing-"/*" are supported`,
      pattern,
    );
  }
  const prefix = pattern.slice(0, starIdx).replace(/\/$/, "");
  const absPrefix = path.join(rootDir, prefix);
  let entries: string[];
  try {
    entries = await fs.readdir(absPrefix);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = path.join(rootDir, rel);
    // fs.stat can fail on race-removal / broken symlinks; pnpm's own
    // matcher tolerates those, so we swallow and skip rather than fail
    // the whole enumeration for one odd directory entry.
    /* v8 ignore next 6 — race-removal / broken-symlink branch is timing-dependent */
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) out.push(rel);
  }
  return out;
}

async function readNpmManifest(
  absDir: string,
  relDir: string,
): Promise<PnpmPackageRecord | null> {
  const manifestPath = path.join(absDir, "package.json");
  // ENOENT is the expected "no manifest here" signal; any other errno
  // (permission denied, EIO) is not something this discovery source can
  // meaningfully recover from — propagate so the invoker's catch-all
  // emits a `probe.discovery-enumerate-failed` log and the tick writes
  // nothing rather than pretending the package doesn't exist.
  const raw = await fs
    .readFile(manifestPath, "utf8")
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      /* v8 ignore next */
      throw err;
    });
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      `package.json failed to parse: ${msg}`,
      manifestPath,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      "package.json is not an object",
      manifestPath,
    );
  }
  const name = (parsed as Record<string, unknown>).name;
  const version = (parsed as Record<string, unknown>).version;
  if (typeof name !== "string" || name.length === 0) {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      "package.json missing `name`",
      manifestPath,
    );
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      "package.json missing `version`",
      manifestPath,
    );
  }
  return { name, pinnedVersion: version, ecosystem: "npm", path: relDir };
}

/**
 * Parse pyproject.toml just enough to extract `name` + `version`. We do
 * NOT pull in a TOML parser dependency — both PEP 621 `[project]` and
 * Poetry's `[tool.poetry]` use the same `key = "value"` grammar for
 * strings at the top of their respective sections, and that's the only
 * shape we need. A more complete parser would pay a real dep for
 * functionality that isn't used anywhere else in showcase-harness.
 *
 * If neither table carries a name+version pair we throw SchemaError —
 * the directory is listed in pnpm-workspace.yaml for SOMETHING, and a
 * pyproject.toml without identifying metadata is a genuine manifest bug.
 */
async function readPyprojectManifest(
  absDir: string,
  relDir: string,
): Promise<PnpmPackageRecord | null> {
  const manifestPath = path.join(absDir, "pyproject.toml");
  // Same ENOENT-is-expected / everything-else-propagates semantics as
  // readNpmManifest above. Kept symmetric so operators reading logs see
  // identical error shapes whether the offending file was package.json
  // or pyproject.toml.
  const raw = await fs
    .readFile(manifestPath, "utf8")
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      /* v8 ignore next */
      throw err;
    });
  if (raw === null) return null;
  const { name, version } = extractPyprojectNameVersion(raw);
  if (!name) {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      "pyproject.toml missing `name` under [project] or [tool.poetry]",
      manifestPath,
    );
  }
  if (!version) {
    throw new DiscoverySourceSchemaError(
      "pnpm-packages",
      "pyproject.toml missing `version` under [project] or [tool.poetry]",
      manifestPath,
    );
  }
  return { name, pinnedVersion: version, ecosystem: "pypi", path: relDir };
}

/**
 * Minimal pyproject.toml extractor — scans for `[project]` / `[tool.poetry]`
 * tables and pulls `name = "..."` and `version = "..."` from whichever
 * appears first. Intentionally naive; a richer TOML (arrays-of-tables,
 * multi-line strings) would break this, but our workspace's pyproject.toml
 * files are flat. See the call-site rationale.
 */
function extractPyprojectNameVersion(raw: string): {
  name: string | null;
  version: string | null;
} {
  const lines = raw.split(/\r?\n/);
  let inTargetTable = false;
  let name: string | null = null;
  let version: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("#") || line === "") continue;
    if (line.startsWith("[")) {
      inTargetTable = line === "[project]" || line === "[tool.poetry]";
      continue;
    }
    if (!inTargetTable) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "name" && name === null) name = value;
    else if (key === "version" && version === null) version = value;
    if (name !== null && version !== null) break;
  }
  return { name, version };
}
