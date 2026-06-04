#!/usr/bin/env npx tsx
/**
 * emit-railway-envs-json.ts — Serialize the railway-envs.ts SSOT to a
 * canonical JSON artifact at `showcase/scripts/railway-envs.generated.json`.
 *
 * Consumers:
 *   - showcase/bin/railway (Ruby) reads this to derive EXPECTED_DOMAINS
 *     instead of maintaining a parallel Ruby hash.
 *   - .github/workflows/showcase_deploy.yml reads it to build the verify
 *     matrix without duplicating the inline JSON array.
 *
 * Idempotent: writes only when the serialized output differs from disk.
 * CI runs this with `--check`: non-zero exit if the on-disk file is stale.
 *
 * Flags:
 *   --check            Exit 1 if on-disk JSON differs from SSOT (don't write).
 *                      Exit 2 if the read fails for any reason other than the
 *                      file being absent (e.g. EACCES, EISDIR) — fail loud
 *                      rather than masquerade a real error as drift.
 *   --out=<path>       Override the output path (used by tests for hermetic
 *                      writes). Defaults to the canonical tracked artifact.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  PRODUCTION_ENV_ID,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
} from "./railway-envs";

const DEFAULT_OUTPUT_PATH = resolve(
  new URL(".", import.meta.url).pathname,
  "railway-envs.generated.json",
);

interface Emitted {
  projectId: string;
  envIds: { staging: string; prod: string };
  services: Array<{
    name: string;
    serviceId: string;
    prodInstanceId: string;
    stagingInstanceId: string;
    ciBuilt: boolean;
    gateValidated: boolean;
    dispatchName?: string;
    repoNameOverride?: { prod?: string; staging?: string };
    domains: { staging: string; prod: string };
    probe: { staging: boolean; prod: boolean; driver: string };
  }>;
}

function buildPayload(): Emitted {
  const services: Emitted["services"] = Object.entries(SERVICES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => ({
      name,
      serviceId: entry.serviceId,
      prodInstanceId: entry.prodInstanceId,
      stagingInstanceId: entry.stagingInstanceId,
      ciBuilt: entry.ciBuilt,
      gateValidated: entry.gateValidated,
      dispatchName: entry.dispatchName,
      repoNameOverride: entry.repoNameOverride,
      domains: { staging: entry.domains.staging, prod: entry.domains.prod },
      probe: {
        staging: entry.probe.staging,
        prod: entry.probe.prod,
        driver: entry.probe.driver,
      },
    }));
  return {
    projectId: PROJECT_ID,
    envIds: { staging: STAGING_ENV_ID, prod: PRODUCTION_ENV_ID },
    services,
  };
}

function serialize(payload: Emitted): string {
  return JSON.stringify(payload, null, 2) + "\n";
}

function parseOutPath(args: string[]): string {
  const flag = args.find((a) => a.startsWith("--out="));
  if (flag) return resolve(flag.slice("--out=".length));
  return DEFAULT_OUTPUT_PATH;
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const outputPath = parseOutPath(args);
  const payload = buildPayload();
  const next = serialize(payload);

  if (check) {
    let current = "";
    try {
      current = readFileSync(outputPath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Non-ENOENT errors (EACCES, EISDIR, etc.) are real failures, not
        // drift. Fail loud so CI surfaces the real cause instead of
        // overwriting on a false signal or printing a misleading "stale"
        // message.
        process.stderr.write(
          `emit-railway-envs-json: failed to read ${outputPath}: ${
            (err as Error).message
          }\n`,
        );
        process.exit(2);
      }
      // ENOENT — file missing, treat as drift below.
    }
    if (current !== next) {
      process.stderr.write(
        `railway-envs.generated.json is stale. Re-run:\n  npx tsx showcase/scripts/emit-railway-envs-json.ts\n`,
      );
      process.exit(1);
    }
    process.stdout.write("railway-envs.generated.json is up to date.\n");
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, next);
  process.stdout.write(`wrote ${outputPath}\n`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("emit-railway-envs-json.ts");
if (isMain) main();
