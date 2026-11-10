/** Structural inventory only: never executes turns, probes, or browser hooks. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, loadFixtureFile, validateFixtures } from "@copilotkit/aimock";
import { parseManifest } from "./lib/manifest.js";
import type { Manifest } from "./lib/manifest.js";
import { REGISTRY_TO_D5 } from "../harness/src/probes/helpers/d5-feature-mapping.js";
import { D5_REGISTRY } from "../harness/src/probes/helpers/d5-registry.js";
import { defaultScriptLoader } from "../harness/src/probes/drivers/d6-all-pills.js";

export interface CoverageResult {
  errors: string[];
  messages: string[];
  exitCode: number;
}
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Missing directories are expected; other IO failures must reach the caller. */
function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sharedCoverage(manifest: Manifest, root: string): string[] {
  const errors: string[] = [];
  const slug = manifest.slug;
  if (!manifest.demos.length)
    return [`${slug}: shared-d6 requires declared demos`];
  for (const demo of manifest.demos) {
    const types = Object.hasOwn(REGISTRY_TO_D5, demo.id)
      ? REGISTRY_TO_D5[demo.id]
      : undefined;
    if (!types?.length) {
      errors.push(`${slug}/${demo.id}: no shared D5 mapping`);
      continue;
    }
    for (const feature of types) {
      let label = `${slug}/${demo.id} (${feature})`;
      try {
        const script = D5_REGISTRY.get(feature);
        if (!script) throw new Error("no registered shared script");
        const file = script.fixtureFile;
        if (
          typeof file !== "string" ||
          !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/.test(file) ||
          file.includes("..")
        )
          throw new Error("fixtureFile must be a safe JSON basename");
        const fixturePath = path.join(root, "aimock/d6", slug, file);
        label += `: ${fixturePath}`;
        // Canonical read/parse/shape failures return []; normalizer warnings stay warnings.
        const fixtures = loadFixtureFile(fixturePath, new Logger("silent"));
        if (!fixtures.length)
          throw new Error("empty or unloadable fixture inventory");
        for (const issue of validateFixtures(fixtures)) {
          if (issue.severity === "error") {
            errors.push(
              `${label}: fixture ${issue.fixtureIndex}: ${issue.message}`,
            );
          }
        }
        if (!fixtures.some((fixture) => fixture.match.context === slug)) {
          errors.push(`${label}: no fixture with exact context '${slug}'`);
        }
      } catch (error) {
        errors.push(`${label}: ${message(error)}`);
      }
    }
  }
  return errors;
}

export async function validateE2eCoverage({
  showcaseRoot: root,
}: {
  showcaseRoot: string;
}): Promise<CoverageResult> {
  const errors: string[] = [];
  const messages: string[] = [];
  const result = (exitCode = errors.length ? 1 : 0): CoverageResult => ({
    errors,
    messages,
    exitCode,
  });
  let baseline: unknown;
  try {
    baseline = JSON.parse(
      fs.readFileSync(path.join(root, "scripts/fail-baseline.json"), "utf8"),
    );
  } catch (error) {
    errors.push(
      `fail-baseline.json: JSON syntax/read error: ${message(error)}`,
    );
    return result(2);
  }
  const minimum =
    baseline && typeof baseline === "object" && "baselineDemoCount" in baseline
      ? baseline.baselineDemoCount
      : undefined;
  if (
    typeof minimum !== "number" ||
    !Number.isInteger(minimum) ||
    minimum < 0
  ) {
    errors.push(
      "fail-baseline.json: schema failure: baselineDemoCount must be a non-negative integer",
    );
    return result(3);
  }
  const integrationsDir = path.join(root, "integrations");
  let entries: string[];
  try {
    entries = fs.readdirSync(integrationsDir).sort();
  } catch (error) {
    errors.push(`Failed to discover integrations: ${message(error)}`);
    return result();
  }
  let found = 0;
  let loaded = false;
  const loadErrors: string[] = [];
  for (const slug of entries) {
    const dir = path.join(integrationsDir, slug);
    try {
      if (!isDirectory(dir)) continue;
      if (!isDirectory(path.join(dir, "src"))) {
        messages.push(`skip: ${slug} (manifest-only, no src/)`);
        continue;
      }
      found++;
      const parsed = parseManifest(path.join(dir, "manifest.yaml"), slug);
      if (parsed.kind !== "ok") {
        errors.push(
          `${slug}: manifest ${parsed.kind}${"error" in parsed ? `: ${parsed.error}` : ""}`,
        );
        continue;
      }
      if (parsed.manifest.test_coverage === "shared-d6") {
        if (!loaded) {
          loaded = true;
          const logError = (msg: string, meta?: Record<string, unknown>) =>
            loadErrors.push(`${msg} ${JSON.stringify(meta ?? {})}`);
          try {
            await defaultScriptLoader({
              now: () => new Date(),
              env: {},
              logger: {
                info() {},
                debug() {},
                warn: logError,
                error: logError,
              },
            });
          } catch (error) {
            loadErrors.push(message(error));
          }
        }
        if (loadErrors.length) {
          errors.push(
            `${slug}: shared script loading failed: ${loadErrors.join("; ")}`,
          );
          continue;
        }
        const sharedErrors = sharedCoverage(parsed.manifest, root);
        errors.push(...sharedErrors);
        if (!sharedErrors.length)
          messages.push(
            `ok: ${slug} has structural shared-d6 coverage for ${parsed.manifest.demos.length} demo(s)`,
          );
        continue;
      }
      const e2eDir = path.join(dir, "tests/e2e");
      if (!isDirectory(e2eDir)) {
        errors.push(
          `Package '${slug}' is missing tests/e2e/ directory (required for baseline e2e coverage)`,
        );
        continue;
      }
      let count: number;
      try {
        count = fs
          .readdirSync(e2eDir, { withFileTypes: true })
          .filter(
            (entry) => entry.isFile() && entry.name.endsWith(".spec.ts"),
          ).length;
      } catch (error) {
        errors.push(
          `Failed while enumerating specs for '${slug}': ${message(error)}`,
        );
        continue;
      }
      if (count < minimum)
        errors.push(
          `Package '${slug}' has ${count} e2e spec(s); minimum required is ${minimum}`,
        );
      else messages.push(`ok: ${slug} has ${count} spec(s)`);
    } catch (error) {
      errors.push(`${slug}: coverage IO failure: ${message(error)}`);
    }
  }
  if (!found)
    errors.push(
      "No source-bearing showcase/integrations/*/ directories found — baseline check cannot run",
    );
  return result();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const showcaseRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = await validateE2eCoverage({ showcaseRoot });
  for (const msg of result.messages) console.log(msg);
  for (const error of result.errors) console.error(`::error::${error}`);
  process.exitCode = result.exitCode;
}
