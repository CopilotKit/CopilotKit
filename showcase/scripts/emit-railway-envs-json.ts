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
    /**
     * SSOT keys of OTHER services to promote alongside this one when
     * showcase_promote.yml resolves it as a single-service target. Emitted
     * ONLY when set (matches the legacy output's "omit-when-unset" idiom for
     * repoNameOverride). resolve-targets reads this field to expand the CSV;
     * see ServiceEntry.promoteDeps in railway-envs.ts.
     */
    promoteDeps?: string[];
  }>;
}

/**
 * Project the env-map `ServiceEntry` back onto the LEGACY per-service JSON
 * shape that Ruby (`bin/railway`) and workflow jq consume. This is the
 * Ruby/jq boundary: the emitted JSON shape is FROZEN at the pre-refactor
 * layout (`prodInstanceId`/`stagingInstanceId`/`domains`/`probe`/
 * `repoNameOverride`) and must stay byte-identical, so this is the only
 * place the env-map is flattened back.
 *
 * Per-env reconstruction:
 *   - `<env>InstanceId`: `environments[env].instanceId`, or — for a
 *     single-env service missing that env — the `serviceId` (legacy
 *     non-functional placeholder; see ServiceEntry.legacyJsonCompat).
 *   - `domains[env]`: `environments[env].domain`, or the legacy borrowed
 *     host from `legacyJsonCompat.domains[env]` for domainless workers.
 *   - `probe[env]`: `environments[env].probe ?? true` (env present), or
 *     `false` (env absent — the legacy default for a non-existent env).
 *   - `repoNameOverride`: rebuilt as `{prod?, staging?}` from the per-env
 *     `repoName` fields, INCLUDED only when at least one env sets one
 *     (matches the legacy output, which omitted the key when unset).
 */
function projectServiceToLegacyJson(
  name: string,
  entry: (typeof SERVICES)[string],
): Emitted["services"][number] {
  const prodEnv = entry.environments.prod;
  const stagingEnv = entry.environments.staging;

  // Real per-env repoName wins; the legacy-compat shim fills an env the
  // env-map schema omits (a single-env worker's absent env still carried a
  // placeholder repoName in the legacy JSON). Built in {prod, staging} key
  // order to match the frozen JSON layout.
  const compatRepo = entry.legacyJsonCompat?.repoNameOverride;
  const prodRepo = prodEnv?.repoName ?? compatRepo?.prod;
  const stagingRepo = stagingEnv?.repoName ?? compatRepo?.staging;
  const repoNameOverride =
    prodRepo !== undefined || stagingRepo !== undefined
      ? {
          ...(prodRepo !== undefined ? { prod: prodRepo } : {}),
          ...(stagingRepo !== undefined ? { staging: stagingRepo } : {}),
        }
      : undefined;

  const compatDomains = entry.legacyJsonCompat?.domains;
  const prodDomain = prodEnv?.domain ?? compatDomains?.prod ?? "";
  const stagingDomain = stagingEnv?.domain ?? compatDomains?.staging ?? "";

  return {
    name,
    serviceId: entry.serviceId,
    // A single-env service (no prod env) keeps the legacy placeholder:
    // prodInstanceId === serviceId. Never dereferenced (staging-only,
    // probe disabled) — exists only for JSON-shape stability.
    prodInstanceId: prodEnv?.instanceId ?? entry.serviceId,
    stagingInstanceId: stagingEnv?.instanceId ?? entry.serviceId,
    ciBuilt: entry.ciBuilt,
    gateValidated: entry.gateValidated,
    dispatchName: entry.dispatchName,
    repoNameOverride,
    domains: { staging: stagingDomain, prod: prodDomain },
    probe: {
      staging: stagingEnv ? (stagingEnv.probe ?? true) : false,
      prod: prodEnv ? (prodEnv.probe ?? true) : false,
      driver: entry.probeDriver,
    },
    // promoteDeps is OPTIONAL on the SSOT (infra leaves have none); emit
    // only when set so the JSON shape for non-integration services stays
    // identical to the pre-feature output (jq's `.promoteDeps[]?` accepts
    // either form so consumers are unaffected by the omission).
    ...(entry.promoteDeps !== undefined && entry.promoteDeps.length > 0
      ? { promoteDeps: [...entry.promoteDeps] }
      : {}),
  };
}

function buildPayload(): Emitted {
  const services: Emitted["services"] = Object.entries(SERVICES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => projectServiceToLegacyJson(name, entry));
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
