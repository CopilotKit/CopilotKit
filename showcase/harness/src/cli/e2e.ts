/**
 * Integration e2e test runner — runs an integration's OWN Playwright e2e
 * suite (`integrations/<slug>/tests/e2e/`) against the locally-running
 * showcase stack, scoped by tier and/or grep.
 *
 * This is distinct from the harness probe-driver path (`runner.ts`, the
 * d4/d5/d6 drivers). The probe drivers orchestrate a synthetic conversation
 * matrix; this path invokes the integration's checked-in Playwright specs
 * directly, which is the canonical "did the demo actually work end-to-end"
 * loop the team uses for D6 verification.
 *
 * Verified manual loop this mirrors:
 *
 *   cd showcase/integrations/<slug>
 *   CI=1 BASE_URL=http://localhost:<port> \
 *     npx playwright test <spec?> --reporter=line --workers=1 --retries=0 -g "<grep>"
 *
 * `CI=1` is MANDATORY — without it the integration's `playwright.config.ts`
 * enables a `webServer` block with `reuseExistingServer`, whose reuse-probe
 * short-circuits and runs zero tests against an already-running server.
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

import type { LocalConfig } from "./config.js";
import { getPackageUrl } from "./config.js";
import { parsePlaywrightJson } from "../probes/helpers/pw-json-reporter.js";
import type { SpecFileResult } from "../probes/helpers/pw-json-reporter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** e2e tier vocabulary. Mirrors the probe-driver levels for a consistent CLI
 *  surface; for the integration's flat spec suite these currently differ only
 *  in retry/worker defaults, with spec selection driven by `--grep`. */
export type E2eTier = "d4" | "d5" | "d6" | "deep";

export interface E2eRunOptions {
  /** Requested tier (defaults to d6). */
  tier?: E2eTier;
  /** Playwright `-g` grep filter (test-title substring/regex). */
  grep?: string;
  /** Optional spec path/name filter (Playwright positional arg). */
  spec?: string;
  /** Worker count override (default 1 — deterministic against shared stack). */
  workers?: number;
  /**
   * Retry count override. When unset, the default is applied in
   * `buildE2eCommand` (the `opts.retries ?? <default>` resolution) — see the
   * worker/retry resolution there for the authoritative value. Two intended
   * caller values:
   *   - `0` (STRICT) — validation/CI and the LGP gate. No flake masking; a
   *     single failure is RED.
   *   - `1` (PRODUCTION probe path) — the live D6 driver. A retried PASS
   *     counts GREEN; an exhausted-retry fail stays RED (Playwright reflects
   *     the final per-case status in the JSON, which the parser reads).
   */
  retries?: number;
  /** Run Playwright in headed mode. */
  headed?: boolean;
  /**
   * Explicit BASE_URL, bypassing `getPackageUrl(slug, config)`. The probe
   * driver path already holds the integration's live URL (Railway/local
   * service) and has no `localPorts` mapping, so it supplies the URL directly
   * instead of resolving it from `shared/local-ports.json`. The human CLI
   * path leaves this unset and resolves via the port map.
   */
  baseUrlOverride?: string;
  /**
   * When set, capture machine-readable per-spec results: the command adds the
   * Playwright `json` reporter (alongside the human `line` reporter) and
   * points `PLAYWRIGHT_JSON_OUTPUT_NAME` at this path. Absent → bare
   * `--reporter=line` (the human CLI contract is unchanged). Set internally
   * by `runE2eAndParse`; CLI callers do not pass it.
   */
  jsonOutputFile?: string;
}

export interface E2eCommand {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Integration directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the on-disk directory for an integration's e2e suite. Checks the
 * canonical `integrations/<slug>` location first, then the legacy
 * `packages/<slug>` path (mirrors `loadManifest()` in targets.ts).
 */
export function resolveIntegrationDir(
  slug: string,
  config: LocalConfig,
): string {
  const integrationsPath = path.join(config.showcaseDir, "integrations", slug);
  const packagesPath = path.join(config.showcaseDir, "packages", slug);

  if (fs.existsSync(path.join(integrationsPath, "playwright.config.ts"))) {
    return integrationsPath;
  }
  if (fs.existsSync(path.join(packagesPath, "playwright.config.ts"))) {
    return packagesPath;
  }
  throw new Error(
    `No Playwright e2e suite found for slug "${slug}". Checked:\n` +
      `  ${path.join(integrationsPath, "playwright.config.ts")}\n` +
      `  ${path.join(packagesPath, "playwright.config.ts")}`,
  );
}

// ---------------------------------------------------------------------------
// Command construction (pure — unit-tested)
// ---------------------------------------------------------------------------

/**
 * Resolve the default Playwright worker count when no explicit override is
 * supplied. Honors the `D6_WORKERS` env knob (used by the strict gate and the
 * compiled-dist probe path to parallelize), otherwise scales to the host:
 * `ceil(cpuCount / 2)`, floored at 4 so even small machines parallelize.
 *
 * A non-numeric or non-positive `D6_WORKERS` is ignored (falls through to the
 * host-scaled default) — never collapses to 0, which Playwright reinterprets
 * as "use all cores" and would silently over-subscribe the browser pool.
 */
export function resolveDefaultWorkers(): number {
  const raw = process.env.D6_WORKERS;
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const cpus = os.cpus()?.length ?? 4;
  return Math.max(4, Math.ceil(cpus / 2));
}

/**
 * Build the concrete Playwright invocation for an integration e2e run.
 *
 * Resolves BASE_URL from the integration's local host port (same source as
 * `bin/showcase up`/`ports` — `shared/local-ports.json` via `getPackageUrl`),
 * forces `CI=1`, and threads tier/grep/worker/retry options through to
 * `playwright test`.
 */
export function buildE2eCommand(
  slug: string,
  opts: E2eRunOptions,
  config: LocalConfig,
): E2eCommand {
  const cwd = resolveIntegrationDir(slug, config);
  const baseUrl = opts.baseUrlOverride ?? getPackageUrl(slug, config);

  // Worker count resolution order:
  //   1. explicit `opts.workers` (caller override — e.g. a test pinning 1)
  //   2. `D6_WORKERS` env (operator/gate knob — parallelizes the strict gate
  //      AND the compiled-dist probe path, which both flow through here without
  //      passing `workers`)
  //   3. parallel default scaled to the host: ceil(cpus/2), floored at 4
  // A non-numeric / non-positive `D6_WORKERS` falls back to the default rather
  // than silently collapsing to 0 (which Playwright treats as "all cores").
  const workers = opts.workers ?? resolveDefaultWorkers();
  const retries = opts.retries ?? 0;

  const args = ["playwright", "test"];
  if (opts.spec) {
    args.push(opts.spec);
  }
  // When JSON capture is requested, chain the json reporter onto the human
  // `line` reporter so operators still see live progress AND we get a
  // machine-readable report. Otherwise keep the bare line reporter.
  const reporter = opts.jsonOutputFile
    ? "--reporter=line,json"
    : "--reporter=line";
  args.push(reporter, `--workers=${workers}`, `--retries=${retries}`);
  if (opts.headed) {
    args.push("--headed");
  }
  if (opts.grep) {
    args.push("-g", opts.grep);
  }

  const env: Record<string, string> = {
    // CI=1 is mandatory — see module header.
    CI: "1",
    BASE_URL: baseUrl,
  };
  if (opts.jsonOutputFile) {
    // Playwright writes the json reporter's output to this path.
    env.PLAYWRIGHT_JSON_OUTPUT_NAME = opts.jsonOutputFile;
  }
  // Single-path browser-server endpoint. When the harness has started its one
  // owned `chromium.launchServer()` (orchestrator boot), it publishes the live
  // ws endpoint as `PLAYWRIGHT_WS_ENDPOINT`. Threading it into the spawned
  // `npx playwright test` env lets the integration's playwright.config.ts
  // `use.connectOptions.wsEndpoint` connect every worker to that ONE server, so
  // the MAIN browser-process count is pinned to the server count regardless of
  // `--workers`. Absent (no server started — e.g. the human CLI path) → the
  // specs launch their own browsers as before.
  const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
  if (wsEndpoint) {
    env.PLAYWRIGHT_WS_ENDPOINT = wsEndpoint;
  }

  return {
    command: "npx",
    args,
    cwd,
    env,
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface E2eResult {
  /** Process exit code (0 == all selected specs passed). */
  exitCode: number;
}

/**
 * Run the integration's Playwright e2e suite. Streams Playwright output to
 * the parent stdio (so the user sees live progress) and returns the exit
 * code rather than throwing, so the CLI layer controls `process.exit`.
 */
export function runE2e(
  slug: string,
  opts: E2eRunOptions,
  config: LocalConfig,
): E2eResult {
  const tier = opts.tier ?? "d6";
  const { command, args, cwd, env } = buildE2eCommand(slug, opts, config);

  const baseUrl = env.BASE_URL;
  const filterDesc = opts.grep ? ` -g "${opts.grep}"` : "";
  console.log(
    `\x1b[36m▸ e2e ${slug} (${tier}) → ${baseUrl}${filterDesc}\x1b[0m`,
  );

  try {
    execFileSync(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    return { exitCode: 0 };
  } catch (err) {
    const code =
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : 1;
    return { exitCode: code };
  }
}

// ---------------------------------------------------------------------------
// Spec-driven measurement: run + parse
// ---------------------------------------------------------------------------

export interface E2eParsedResult extends E2eResult {
  /**
   * Per-spec-FILE verdicts parsed from the Playwright JSON reporter. EMPTY
   * when the run errored before producing parseable JSON — the fail-closed
   * D6 rollup maps an absent row → `unknown`, so a crashed/empty run can
   * never manufacture a green cell.
   */
  specResults: SpecFileResult[];
}

/**
 * Injection seam for `runE2eAndParse` so the probe-driver and unit tests can
 * substitute the process spawn. `execImpl` runs the built Playwright command
 * (which is configured to write its JSON report to `jsonOutputFile`) and
 * returns the process exit code; the default spawns Playwright via
 * `execFileSync`.
 */
export interface RunE2eAndParseDeps {
  execImpl?: (cmd: E2eCommand, jsonOutputFile: string) => number;
}

/**
 * Run an integration's Playwright e2e suite with the JSON reporter, then parse
 * the report into per-spec-FILE verdicts.
 *
 * This is the spec-driven measurement entrypoint the D6 probe driver consumes:
 * it replaces the old DOM-node-counting heuristic with the integration's OWN
 * gold specs. The JSON report is written to a private temp file, parsed via
 * `parsePlaywrightJson`, and the temp file is cleaned up.
 *
 * FAIL-CLOSED: if the run errors before producing a parseable JSON report
 * (crash, no file, malformed JSON), `specResults` is `[]`. The rollup treats
 * an absent per-spec row as `unknown` (never green) — so a failed run can
 * never green a cell through this path.
 */
export function runE2eAndParse(
  slug: string,
  opts: E2eRunOptions,
  config: LocalConfig,
  deps: RunE2eAndParseDeps = {},
): E2eParsedResult {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "d6-e2e-"));
  const jsonOutputFile = path.join(tmpDir, "report.json");

  const cmd = buildE2eCommand(slug, { ...opts, jsonOutputFile }, config);

  const execImpl =
    deps.execImpl ??
    ((c: E2eCommand, _jsonFile: string): number => {
      try {
        execFileSync(c.command, c.args, {
          cwd: c.cwd,
          stdio: "inherit",
          env: { ...process.env, ...c.env },
        });
        return 0;
      } catch (err) {
        return typeof (err as { status?: unknown }).status === "number"
          ? (err as { status: number }).status
          : 1;
      }
    });

  let exitCode: number;
  try {
    exitCode = execImpl(cmd, jsonOutputFile);
  } catch {
    // The runner itself threw (not just a non-zero exit) — treat as a failed
    // run with no parseable results.
    exitCode = 1;
  }

  let specResults: SpecFileResult[] = [];
  try {
    // Read directly and let a missing-file error fall through to the empty
    // fail-closed result. (We avoid `existsSync` here so the report check is
    // never confused with integration-dir resolution.)
    const raw = fs.readFileSync(jsonOutputFile, "utf8");
    specResults = parsePlaywrightJson(JSON.parse(raw));
  } catch {
    // No file (run crashed before reporting), malformed, or unreadable JSON
    // → fail-closed empty results.
    specResults = [];
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; a leaked temp dir is not worth failing the run.
    }
  }

  return { exitCode, specResults };
}
