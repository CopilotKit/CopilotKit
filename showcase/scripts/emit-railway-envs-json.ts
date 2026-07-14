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
 *
 * Env:
 *   EMIT_SKIP_OXFMT=1  Skip the oxfmt-canonical pass and emit raw
 *                      `JSON.stringify(_, null, 2)` instead. Set ONLY on the
 *                      EPHEMERAL consumers (the promote workflow's
 *                      resolve-targets / promote jobs) where the emitted JSON
 *                      is parsed in-memory by jq / bin/railway and NEVER
 *                      committed, so canonical formatting is irrelevant and the
 *                      repo-root oxfmt binary is not installed. On the DEFAULT
 *                      (committed-artifact) path this is unset and oxfmt is
 *                      REQUIRED — a missing binary fails loud (it must, or CI's
 *                      `oxfmt --check` auto-format bot would fire on drift).
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  PRODUCTION_ENV_ID,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
  computePromoteClosure,
} from "./railway-envs";
import type { ClosurePlan, WorkerProvisioning } from "./railway-envs";

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
    // --- Promote-closure fields (ADDITIVE, U2). Appended AFTER the frozen
    // legacy keys above so the Ruby/jq legacy shape stays byte-identical. ---
    // Effective promote tier (declared `promoteTier`, default 2). ALWAYS
    // emitted so the Ruby CLI + workflow jq never have to recompute the
    // default. 0 = shared infra, 1 = verification control plane, 2 = leaf.
    promoteTier: 0 | 1 | 2;
    // SSOT keys this service needs present-and-current to be meaningful.
    // OMITTED when the SSOT entry declares none (matches the leaf default).
    runtimeDeps?: string[];
    // Cross-service env-var references the Stage-2 Ruby preflight (U5)
    // ASSERTS. OMITTED when the SSOT entry declares none.
    serviceRefs?: { key: string; target: string }[];
    // Standalone leaf (no deps, never gated). OMITTED unless true so normal
    // tier-gated services keep the frozen shape. Read by the resolve-targets jq
    // (closure: skip Tier-1 union for an all-standalone request) + the fleet
    // driver (promote ungated, never NOT-ATTEMPTED on an unrelated failure).
    standalone?: boolean;
    // Per-env Railway HTTP healthcheck path (ADDITIVE). Read by the Ruby
    // promote pin to RE-ASSERT the tracked path on every promote (the durable
    // fix for the aimock silent-null incident). Each env key is emitted ONLY
    // when the SSOT declares a healthcheckPath for that env — a live-null
    // service omits the key (and the pin omits the mutation field, never
    // sending `null`). The whole `healthcheckPath` object is omitted when
    // NEITHER env declares one, so live-null services keep the frozen shape.
    healthcheckPath?: { prod?: string; staging?: string };
    // Worker-fleet provisioning record (ADDITIVE, SSOT). Only present for
    // `harness-workers`; omitted for all other services. The drift-gate test
    // (`harness-workers-provisioning.test.ts`) asserts that the SSOT
    // `effectiveReplicas` values (multiRegionConfig.us-west2.numReplicas — the
    // field Railway honors) match this committed snapshot — the authoritative
    // worker-count source. The top-level `numReplicas` mirror rides along.
    workerProvisioning?: {
      prod: WorkerProvisioning;
      staging: WorkerProvisioning;
    };
    // Upstream provider-key env-var NAMES this service sources from a Railway
    // environment-shared variable (${{shared.<NAME>}}) rather than holding its
    // own copy of the real secret (the credential-hygiene single-source model).
    // The Ruby preflight asserts each listed key resolves to the shared
    // variable, never a distinct per-service literal. Appended LAST (additive)
    // and OMITTED when the SSOT entry declares none, so services that source no
    // shared provider key (e.g. aimock) keep the frozen shape.
    sharedRefs?: string[];
  }>;
  // --- Top-level promote-closure plan (ADDITIVE, U2). The tier-ordered
  // closure for the FULL fleet (`all`), computed via `computePromoteClosure`.
  // Consumed by the workflow's resolve-targets jq (U3) + the fleet driver
  // (U4) so the tiered plan is a single source of truth read from the JSON
  // rather than recomputed in bash. Per-service `closure` for a NAMED subset
  // is recomputed by the consumer from the per-service fields above. ---
  closure: ClosurePlan;
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

  // Per-env healthcheckPath: mirror the per-env-flat ({prod, staging}) legacy
  // shape used by domains/repoNameOverride. Each env key is conditionally
  // spread (omitted when the EnvironmentConfig omits it), and the whole object
  // is included ONLY when at least one env declares a path — a live-null
  // service (both envs omit) keeps the frozen shape with NO healthcheckPath
  // key, exactly like repoNameOverride.
  const prodHealthcheck = prodEnv?.healthcheckPath;
  const stagingHealthcheck = stagingEnv?.healthcheckPath;
  const healthcheckPath =
    prodHealthcheck !== undefined || stagingHealthcheck !== undefined
      ? {
          ...(prodHealthcheck !== undefined ? { prod: prodHealthcheck } : {}),
          ...(stagingHealthcheck !== undefined
            ? { staging: stagingHealthcheck }
            : {}),
        }
      : undefined;

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
    // --- Promote-closure fields, appended AFTER `probe` so every legacy key
    // keeps its frozen serialization position (the golden contract). ---
    // Default to the leaf tier 2 when omitted, matching `computePromoteClosure`.
    promoteTier: entry.promoteTier ?? 2,
    // Omit the key entirely when the SSOT declares none, so the leaf default
    // (no deps / no refs) does not add empty arrays to every leaf service.
    ...(entry.runtimeDeps !== undefined
      ? { runtimeDeps: entry.runtimeDeps }
      : {}),
    ...(entry.serviceRefs !== undefined
      ? { serviceRefs: entry.serviceRefs }
      : {}),
    // Standalone leaf: emitted only when true (keeps the leaf default shape).
    ...(entry.standalone === true ? { standalone: true } : {}),
    // Per-env healthcheckPath, appended AFTER the legacy keys (additive). The
    // golden test projects only LEGACY_KEYS so this stays byte-safe; omitted
    // entirely for live-null services so their frozen shape is preserved.
    ...(healthcheckPath !== undefined ? { healthcheckPath } : {}),
    // Worker-fleet provisioning (ADDITIVE). Only emitted for `harness-workers`;
    // omitted for all other services so the frozen per-service shape is
    // preserved. The drift-gate test (`harness-workers-provisioning.test.ts`)
    // asserts SSOT effectiveReplicas matches this committed snapshot — compare
    // SSOT vs. snapshot, never vs. a live Railway API call.
    ...(entry.workerProvisioning !== undefined
      ? { workerProvisioning: entry.workerProvisioning }
      : {}),
    // Shared provider-key references (ADDITIVE, credential-hygiene model).
    // Emitted only when the SSOT declares `sharedRefs`, so services that hold
    // no shared provider key (aimock, harness, pocketbase, …) keep the frozen
    // per-service shape. Read by the Ruby preflight to assert each listed key
    // resolves to the Railway environment-shared variable, never a distinct
    // per-service literal.
    ...(entry.sharedRefs !== undefined ? { sharedRefs: entry.sharedRefs } : {}),
  };
}

function buildPayload(): Emitted {
  const services: Emitted["services"] = Object.entries(SERVICES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => projectServiceToLegacyJson(name, entry));
  // The full-fleet (`all`) closure: tier-ordered promotable services + the
  // skipped-with-reason members. `computePromoteClosure` is the SSOT for the
  // tiering; emitting it here keeps the workflow jq + fleet driver from
  // re-implementing the closure math in bash.
  const closure = computePromoteClosure(Object.keys(SERVICES));
  return {
    projectId: PROJECT_ID,
    envIds: { staging: STAGING_ENV_ID, prod: PRODUCTION_ENV_ID },
    services,
    closure,
  };
}

/**
 * The repo-root oxfmt binary. CI's `static_quality.yml` formats this
 * artifact with oxfmt and auto-commits any drift, so the emitter must
 * produce oxfmt-CANONICAL output — otherwise `oxfmt --check` (CI) and
 * `emit --check` (this script's raw string compare) conflict forever:
 * oxfmt wants compact arrays (`["pocketbase","harness"]`), the raw
 * `JSON.stringify(_, null, 2)` emits multi-line ones. Routing the write
 * path AND the `--check` comparison through oxfmt makes on-disk ==
 * emitter-oxfmt-output == oxfmt-canonical, so both checks pass with no bot.
 */
const OXFMT_BIN = resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "..",
  "node_modules",
  ".bin",
  "oxfmt",
);

/**
 * Run the committed oxfmt over a JSON string and return the canonical
 * formatting. We shell out to the SAME binary CI uses (rather than the
 * programmatic API, which would not auto-discover the repo `.oxfmtrc.json`)
 * so the emitter's output is byte-identical to what CI's `oxfmt --check`
 * accepts. The temp file is created NEXT TO the final artifact's directory
 * so oxfmt resolves the same `.oxfmtrc.json` (printWidth: 80) it would for
 * the real file — config discovery walks up from the file path.
 */
function oxfmtCanonical(json: string, nearDir: string): string {
  const tmpDir = mkdtempSync(join(nearDir, ".emit-oxfmt-"));
  const tmpFile = join(tmpDir, "railway-envs.generated.json");
  try {
    writeFileSync(tmpFile, json);
    execFileSync(OXFMT_BIN, ["--write", tmpFile], { stdio: "pipe" });
    return readFileSync(tmpFile, "utf8");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function serialize(payload: Emitted, nearDir: string): string {
  const raw = JSON.stringify(payload, null, 2) + "\n";
  // EMIT_SKIP_OXFMT is an EXPLICIT opt-out for the ephemeral consumers (the
  // promote workflow's resolve-targets / promote jobs) where the JSON is parsed
  // in-memory and never committed, so canonical formatting is irrelevant and
  // the repo-root oxfmt binary is not installed by that job's `npm ci`. This is
  // opt-IN-to-skip on purpose: the DEFAULT path keeps oxfmt REQUIRED and fails
  // loud if the binary is absent (oxfmtCanonical throws ENOENT), because the
  // committed artifact MUST stay oxfmt-canonical or CI's `oxfmt --check`
  // auto-format bot fires on the drift. We never silently skip on absence.
  if (process.env.EMIT_SKIP_OXFMT === "1") {
    return raw;
  }
  return oxfmtCanonical(raw, nearDir);
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
  const outputDir = dirname(outputPath);
  const payload = buildPayload();
  // The oxfmt temp file is created inside `outputDir` so config discovery
  // resolves the same `.oxfmtrc.json` the real artifact would. Ensure the
  // directory exists before serializing (the write path also recreates it
  // below; this covers `--check` against a not-yet-created --out dir).
  mkdirSync(outputDir, { recursive: true });
  const next = serialize(payload, outputDir);

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

  // outputDir already created above (so the oxfmt temp file could resolve
  // the repo `.oxfmtrc.json`); just write the canonical artifact.
  writeFileSync(outputPath, next);
  process.stdout.write(`wrote ${outputPath}\n`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("emit-railway-envs-json.ts");
if (isMain) main();
