/**
 * resolve-verify-matrix.ts — decide which staging services the
 * post-redeploy verify probe should target.
 *
 * Replaces the inline bash+jq block in showcase_deploy.yml's
 * `resolve-matrix` job ("Build verify matrix from SSOT" step). The bash
 * had produced two confirmed bugs across prior CR rounds, so the logic
 * was extracted into a pure, unit-testable TypeScript function.
 *
 * Decision table — `resolveVerifyMatrix` returns `{servicesCsv, hasServices}`:
 *
 *   workflow_dispatch + service='all'/empty
 *     → full probe-eligible set (every SSOT service with probe.staging===true),
 *       sorted+dedup'd. has_services=true.
 *
 *   workflow_dispatch + specific service (SSOT key OR dispatchName)
 *     → just that one canonical name. Unknown service → throws (CLI wrapper
 *       exits non-zero with `::error::` annotation, matching prior bash).
 *
 *   workflow_run + summary_present='false'
 *     → has_services=false, services_csv=''. Nothing was redeployed (build
 *       legitimately had no buildable changes); skip verify.
 *
 *   workflow_run + summary_present='true' + ok_services empty
 *     → has_services=false, services_csv=''. ALL services errored on
 *       redeploy → the success-set is empty → nothing left to verify.
 *       `enforce-redeploy-gate` independently reds the workflow on
 *       redeploy_red=true, so this case is already loud. The PRIOR bash
 *       fell through to the full probe-eligible fleet here, gratuitously
 *       probing every service against stale `:latest`; that was the
 *       "Issue A" bug this module fixes.
 *
 *   workflow_run + summary_present='true' + ok_services non-empty
 *     → intersect ok_services with probe-eligible SSOT services. The
 *       ok_services CSV may carry SSOT keys OR dispatchName aliases;
 *       both spellings resolve to the canonical name. Result is sorted,
 *       dedup'd, CSV-joined. has_services=(csv non-empty).
 *
 * Testability: the pure function takes `ssotServices` as a parameter so
 * tests run without filesystem IO. The CLI wrapper at the bottom reads
 * env vars, loads `railway-envs.generated.json` (regenerating via
 * emit-railway-envs-json.ts if missing — preserves the fallback the
 * old bash had), and writes `services_csv=` / `has_services=` lines to
 * $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface SsotService {
  name: string;
  dispatchName: string | null;
  probe: { staging: boolean };
}

/** Accepted github.event_name values for this resolver. */
export type SupportedEventName = "workflow_run" | "workflow_dispatch";

export interface ResolveVerifyMatrixInput {
  /** github.event_name — 'workflow_run' or 'workflow_dispatch'. */
  eventName: SupportedEventName;
  /** 'true' / 'false' / '' — the upstream `check-redeploy-summary` step output. */
  summaryPresent: string;
  /** CSV of services that redeployed OK (from `redeploy-gate.outputs.ok_services`). */
  okFromRedeploy: string;
  /** github.event.inputs.service — 'all', '', or an SSOT key / dispatchName. */
  dispatchService: string;
  /** The `services` array from railway-envs.generated.json. */
  ssotServices: SsotService[];
}

export interface ResolveVerifyMatrixOutput {
  servicesCsv: string;
  hasServices: boolean;
}

/** Sorted, dedup'd list of every SSOT service with probe.staging===true. */
function probeEligibleNames(ssotServices: SsotService[]): string[] {
  // Shape is guaranteed by parseSsotServices (every service has a `probe`
  // object with a boolean `staging`), so no defensive optional chain.
  const names = ssotServices
    .filter((s) => s.probe.staging === true)
    .map((s) => s.name);
  return Array.from(new Set(names)).sort();
}

/**
 * Map an `ok_services` CSV (which may carry SSOT keys OR dispatchName
 * aliases — the build matrix sometimes emits dispatch_names) into the
 * set of canonical SSOT names.
 *
 * Tokens are .trim()'d before lookup so a future change to the
 * redeploy-gate bash (or a human-typed workflow_dispatch caller) that
 * emits "a, b" with spaces does not silently drop tokens. Unmatched
 * tokens are returned in `dropped` so the CLI wrapper can surface them
 * via `::warning::` — a silent drop here is the exact SSOT/build drift
 * smell that the boundary hardening is supposed to detect. Empty tokens
 * (trailing comma, double comma) are filtered before matching and are
 * NOT reported as dropped (they carry no signal).
 */
export interface OkCsvResult {
  canonical: Set<string>;
  dropped: string[];
}

export function okCsvToCanonicalNames(
  okFromRedeploy: string,
  ssotServices: SsotService[],
): OkCsvResult {
  const canonical = new Set<string>();
  const dropped: string[] = [];
  const tokens = okFromRedeploy
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const t of tokens) {
    const match = ssotServices.find(
      (s) => s.name === t || s.dispatchName === t,
    );
    if (match) {
      canonical.add(match.name);
    } else {
      dropped.push(t);
    }
  }
  return { canonical, dropped };
}

export function resolveVerifyMatrix(
  input: ResolveVerifyMatrixInput,
): ResolveVerifyMatrixOutput {
  const {
    eventName,
    summaryPresent,
    okFromRedeploy,
    dispatchService,
    ssotServices,
  } = input;

  // Fail loud on unrecognized eventName. Today only `workflow_run` and
  // `workflow_dispatch` reach this resolver (showcase_deploy.yml's `on:`
  // block is closed to those two). Any other value here means either a
  // typo in the wrapper's env wiring or a new trigger that hasn't been
  // explicitly handled — the prior fall-through to the workflow_run
  // intersection branch silently emitted has_services=false for both,
  // indistinguishable from a legit "no summary, nothing to verify" skip.
  if (
    eventName !== "workflow_run" &&
    eventName !== "workflow_dispatch"
  ) {
    throw new Error(
      `::error::resolve-verify-matrix: unexpected eventName '${eventName}' (expected 'workflow_run' or 'workflow_dispatch')`,
    );
  }

  // Case: workflow_run + nothing redeployed — the build legitimately
  // didn't redeploy anything (no buildable service changed). Skip verify.
  if (eventName === "workflow_run" && summaryPresent === "false") {
    return { servicesCsv: "", hasServices: false };
  }

  // Case: workflow_run + redeploy summary PRESENT + empty ok_services
  // (every service errored on redeploy). The success-set is empty, so
  // there is nothing to verify. `enforce-redeploy-gate` already reds
  // the workflow on redeploy_red=true; this matrix simply skips. This
  // is the "Issue A" fix: the old bash fell through to the full
  // probe-eligible fleet here.
  if (
    eventName === "workflow_run" &&
    summaryPresent === "true" &&
    okFromRedeploy.length === 0
  ) {
    return { servicesCsv: "", hasServices: false };
  }

  const probeEligible = probeEligibleNames(ssotServices);

  // workflow_dispatch: resolve the dispatch input first. If 'all' / empty,
  // fall through to the full probe-eligible set. Otherwise resolve to
  // the chosen service (by SSOT name OR dispatchName).
  if (eventName === "workflow_dispatch") {
    const dispatch = dispatchService || "all";
    if (dispatch !== "all") {
      const resolved = ssotServices.find(
        (s) => s.name === dispatch || s.dispatchName === dispatch,
      );
      if (!resolved) {
        // Preserves prior bash behavior: `::error::Unknown service...` +
        // exit 1. The CLI wrapper converts this throw into a non-zero
        // exit with the same annotation.
        throw new Error(
          `::error::Unknown service '${dispatch}' (not an SSOT key or dispatch_name)`,
        );
      }
      const csv = resolved.name;
      return { servicesCsv: csv, hasServices: csv.length > 0 };
    }
    const csv = probeEligible.join(",");
    return { servicesCsv: csv, hasServices: csv.length > 0 };
  }

  // workflow_run + summary present + ok non-empty: intersect ok with
  // probe-eligible. Map ok-tokens to canonical names first (handles the
  // dispatchName-alias case). Drop anything not in probe-eligible (e.g.
  // a service that redeployed OK but has no probe driver).
  const { canonical: okCanonical } = okCsvToCanonicalNames(
    okFromRedeploy,
    ssotServices,
  );
  const intersection = probeEligible.filter((n) => okCanonical.has(n));
  const csv = intersection.join(",");
  return { servicesCsv: csv, hasServices: csv.length > 0 };
}

// ---------------------------------------------------------------------------
// CLI wrapper — guarded by import.meta.url check so tests can import the
// pure function without triggering env reads or filesystem IO.
// ---------------------------------------------------------------------------

const SSOT_JSON = "showcase/scripts/railway-envs.generated.json";
const EMIT_SCRIPT = "showcase/scripts/emit-railway-envs-json.ts";

/**
 * Validate the parsed SSOT JSON shape. A truncated or schema-drifted
 * SSOT (emitter crashed mid-write, or someone renamed `probe.staging`)
 * parses fine but silently shrinks/empties the probe-eligible set,
 * which the resolver then propagates as a false-green skip. We require
 * the shape we depend on, and `::error::`-prefix the throw so the
 * workflow log surfaces it as an annotation.
 */
export function parseSsotServices(
  raw: unknown,
  path: string,
): SsotService[] {
  if (raw === null || typeof raw !== "object") {
    throw new Error(
      `::error::SSOT ${path} malformed: top-level value is not an object`,
    );
  }
  const services = (raw as { services?: unknown }).services;
  if (!Array.isArray(services)) {
    throw new Error(
      `::error::SSOT ${path} malformed: \`services\` is not an array`,
    );
  }
  if (services.length === 0) {
    throw new Error(
      `::error::SSOT ${path} malformed: \`services\` is empty (emitter crashed mid-write or schema drift?)`,
    );
  }
  const validated: SsotService[] = [];
  for (let i = 0; i < services.length; i++) {
    const s = services[i];
    if (s === null || typeof s !== "object") {
      throw new Error(
        `::error::SSOT ${path} malformed: services[${i}] is not an object`,
      );
    }
    const obj = s as {
      name?: unknown;
      dispatchName?: unknown;
      probe?: unknown;
    };
    if (typeof obj.name !== "string" || obj.name.length === 0) {
      throw new Error(
        `::error::SSOT ${path} malformed: services[${i}] missing \`name\` (or not a non-empty string)`,
      );
    }
    // dispatchName is OPTIONAL in the live SSOT (e.g. `pocketbase` has
    // no dispatchName field — it is not a CI-built service). Accept
    // missing OR null OR string; normalize to null internally.
    if (
      obj.dispatchName !== undefined &&
      obj.dispatchName !== null &&
      typeof obj.dispatchName !== "string"
    ) {
      throw new Error(
        `::error::SSOT ${path} malformed: services[${i}] (${obj.name}) \`dispatchName\` must be string, null, or absent`,
      );
    }
    if (obj.probe === null || typeof obj.probe !== "object") {
      throw new Error(
        `::error::SSOT ${path} malformed: services[${i}] (${obj.name}) missing \`probe\` object`,
      );
    }
    const probe = obj.probe as { staging?: unknown };
    if (typeof probe.staging !== "boolean") {
      throw new Error(
        `::error::SSOT ${path} malformed: services[${i}] (${obj.name}) \`probe.staging\` is not boolean`,
      );
    }
    validated.push({
      name: obj.name,
      dispatchName:
        typeof obj.dispatchName === "string" ? obj.dispatchName : null,
      probe: { staging: probe.staging },
    });
  }
  return validated;
}

function loadSsotServices(): SsotService[] {
  // Preserve the prior bash behavior: regenerate the JSON if it's missing
  // (e.g. a freshly-checked-out workspace that hasn't run the emitter).
  if (!existsSync(SSOT_JSON)) {
    execFileSync("npx", ["tsx", EMIT_SCRIPT], { stdio: "inherit" });
  }
  // Re-check existence after the regen attempt: if the emitter exits 0
  // without writing (transient race, broken IO, mis-configured cwd), the
  // pre-fix code would JSON.parse a ReadFile-against-missing-path error
  // and fail with a useless stack. Fail loud instead.
  if (!existsSync(SSOT_JSON)) {
    throw new Error(
      `::error::SSOT ${SSOT_JSON} still missing after regenerate attempt (${EMIT_SCRIPT} exited 0 without writing?)`,
    );
  }
  const raw: unknown = JSON.parse(readFileSync(SSOT_JSON, "utf-8"));
  return parseSsotServices(raw, SSOT_JSON);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string") {
    throw new Error(`resolve-verify-matrix: $${name} is required`);
  }
  return v;
}

function writeGithubOutput(
  githubOutput: string,
  servicesCsv: string,
  hasServices: boolean,
): void {
  // Plain key=value lines (no heredoc): both values are simple strings
  // without newlines. Matches the style of the prior bash and aligns
  // with the rest of resolve-matrix's $GITHUB_OUTPUT writes.
  appendFileSync(githubOutput, `services_csv=${servicesCsv}\n`);
  appendFileSync(
    githubOutput,
    `has_services=${hasServices ? "true" : "false"}\n`,
  );
}

function main(): void {
  const githubOutput = requireEnv("GITHUB_OUTPUT");
  const eventNameRaw = requireEnv("EVENT_NAME");
  const summaryPresent = process.env.SUMMARY_PRESENT ?? "";
  const okFromRedeploy = process.env.OK_FROM_REDEPLOY ?? "";
  const dispatchService = process.env.DISPATCH_SERVICE ?? "";

  try {
    // Narrow the raw env-string to the resolver's literal union. The
    // resolver itself also fails loud on unknown eventName (FIX 3) — the
    // cast just satisfies the type system; runtime validation lives in
    // the resolver so both call paths (tests + CLI) share one guard.
    const eventName = eventNameRaw as
      | "workflow_run"
      | "workflow_dispatch";

    const ssotServices = loadSsotServices();

    // Surface SSOT/build drift via ::warning:: when an ok_services token
    // matches no SSOT service. The resolver-level intersection already
    // drops the token; without this log, the operator never learns that
    // a redeploy reported success for a service the SSOT has forgotten
    // about (or vice versa). Keep this in the wrapper (not the pure
    // function) so the resolver stays IO-free.
    const okPreview = okCsvToCanonicalNames(okFromRedeploy, ssotServices);
    if (okPreview.dropped.length > 0) {
      process.stderr.write(
        `::warning::ok_services tokens dropped (no SSOT match): ${okPreview.dropped.join(",")}\n`,
      );
    }

    const { servicesCsv, hasServices } = resolveVerifyMatrix({
      eventName,
      summaryPresent,
      okFromRedeploy,
      dispatchService,
      ssotServices,
    });
    writeGithubOutput(githubOutput, servicesCsv, hasServices);
  } catch (e) {
    // Mirror the prior bash: print `::error::...` to stderr and exit 1.
    // Throws from this module already carry the `::error::` annotation
    // (Unknown service, unexpected eventName, SSOT malformed, SSOT
    // missing-after-regen).
    process.stderr.write(
      `${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  }
}

const invokedDirectly = (() => {
  try {
    return (
      typeof process !== "undefined" &&
      Array.isArray(process.argv) &&
      process.argv[1] === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
