#!/usr/bin/env npx tsx
/**
 * verify-deploy.ts — Parameterized per-env probe driven off
 * railway-envs.ts SSOT.
 *
 * Usage:
 *   npx tsx showcase/scripts/verify-deploy.ts --env <staging|prod>
 *     [--services <csv>]
 *
 * Behavior:
 *   - Iterates SERVICES from the SSOT; for every entry where
 *     probe[env] === true, runs the per-driver feature-level verifier
 *     against domainFor(name, env). HTTP 200 is necessary, not sufficient.
 *   - Refuses to start if a probe-required service has no domain for
 *     the requested env (fail loud; no silent skip).
 *   - Exits 0 only when every probed service is green. Any red → exit 1.
 *
 * Drivers live in showcase/scripts/verify-deploy.drivers.ts and dispatch on
 * ProbeDriver. The driver is feature-level (DOM string + known network call
 * for shells; fixture replay for aimock; admin login for pocketbase; etc.).
 */

import { runDriver } from "./verify-deploy.drivers";
import type { ProbeRunner } from "./verify-deploy.drivers";
import { SERVICES, domainFor, resolveEnv } from "./railway-envs";
import type { EnvName, ProbeDriver } from "./railway-envs";

export interface ParsedArgs {
  env: EnvName;
  services?: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  let envRaw: string | undefined;
  let services: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env") {
      const v = argv[++i];
      // Guard a bare trailing `--env` (undefined) here so the
      // operator gets a precise, flag-named diagnostic instead of
      // the downstream `resolveEnv` "Unknown env" / "--env required"
      // surface. Mirrors the same guard on `--services`.
      if (v === undefined) {
        throw new Error("--env requires a value (staging|prod)");
      }
      envRaw = v;
    } else if (a.startsWith("--env=")) {
      const v = a.slice("--env=".length);
      // `--env=` (empty post-equals) is the equals-form twin of the
      // bare-trailing case above; collapse both to the same precise
      // error rather than deferring to `resolveEnv`.
      if (v === "") {
        throw new Error("--env requires a value (staging|prod)");
      }
      envRaw = v;
    } else if (a === "--services") {
      const v = argv[++i];
      if (!v) throw new Error("--services requires a CSV value");
      services = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Symmetry with the equals-form below: a raw value like `,,`
      // or `"  "` survives the `!v` guard but produces an empty
      // post-filter list. Throw the same precise error here so both
      // forms behave identically.
      if (services.length === 0) {
        throw new Error("--services requires a CSV value");
      }
    } else if (a.startsWith("--services=")) {
      const v = a.slice("--services=".length);
      if (!v) throw new Error("--services requires a CSV value");
      services = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (services.length === 0) {
        throw new Error("--services requires a CSV value");
      }
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!envRaw) {
    throw new Error("--env is required (staging|prod)");
  }
  const { env } = resolveEnv(envRaw);
  return services === undefined ? { env } : { env, services };
}

/**
 * Branded host type for `ProbeTarget.host`.
 *
 * A `Host` is a bare hostname literal (no scheme, no path, no slash) —
 * exactly the shape `domainFor()` is documented to return. The brand is
 * structural only: at runtime a `Host` IS a string, so it is assignable
 * to any `string`-typed parameter (e.g. `checkHealthcheck200(host, ...)`)
 * with no runtime cost. The point is to prevent the inverse direction —
 * a caller cannot hand a `ProbeTarget` a scheme-included or path-bearing
 * string without going through `asHost()`, which validates fail-loud.
 *
 * Co-located with `ProbeTarget` (the only structural consumer) rather
 * than in `railway-envs.ts` to keep the brand at the verify-pipeline
 * boundary; `domainFor()` keeps its `string` return type and we validate
 * + brand at the point of ingress in `resolveProbeTargets`.
 */
export type Host = string & { readonly __brand: "Host" };

/**
 * Validate + brand a bare hostname literal as a `Host`. Throws on any
 * scheme separator (`://`), any slash (path component), leading/trailing
 * whitespace, or any of `@` (userinfo), `?` (query), `#` (fragment) — the
 * verify-deploy pipeline never wants any of these — drivers always build
 * URLs as `https://${host}${path}`, so a host carrying any of those would
 * produce malformed URLs at the driver boundary.
 *
 * Overlap with `domainFor()` is partial, not full: `domainFor` re-checks
 * scheme + empty on the normal SSOT path, but does NOT check path/slash
 * or the whitespace/userinfo/query/fragment cases that `asHost` rejects.
 * The override seam in `resolveProbeTargets` (test-only path that bypasses
 * `domainFor` entirely) is what makes the `asHost` call mandatory — it is
 * the sole ingress that gets to skip `domainFor`'s checks.
 */
export function asHost(value: string): Host {
  if (value.includes("://")) {
    throw new Error(`asHost: host must not include a scheme (got "${value}")`);
  }
  if (value.includes("/")) {
    throw new Error(
      `asHost: host must not include a path or slash (got "${value}")`,
    );
  }
  if (value.length === 0) {
    throw new Error(`asHost: host must not be empty`);
  }
  if (value !== value.trim()) {
    throw new Error(
      `asHost: host must not have leading/trailing whitespace (got "${value}")`,
    );
  }
  if (value.includes("@")) {
    throw new Error(
      `asHost: host must not include userinfo "@" (got "${value}")`,
    );
  }
  if (value.includes("?")) {
    throw new Error(
      `asHost: host must not include a query "?" (got "${value}")`,
    );
  }
  if (value.includes("#")) {
    throw new Error(
      `asHost: host must not include a fragment "#" (got "${value}")`,
    );
  }
  return value as Host;
}

export interface ProbeTarget {
  readonly name: string;
  readonly host: Host;
  readonly driver: ProbeDriver;
}

export interface ResolveOpts {
  env: EnvName;
  services?: string[];
  /** Test seam: shallow-merge a partial entry over the SSOT before resolve. */
  overrides?: Record<string, { domains?: { staging: string; prod: string } }>;
}

export function resolveProbeTargets(opts: ResolveOpts): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  const filter = opts.services ? new Set(opts.services) : undefined;
  // Validate user-supplied service names against the SSOT BEFORE
  // filtering — a typo (`docss`) or a name that's not probe-eligible
  // for the target env must surface as a clear, distinct error, not a
  // silent zero-targets vacuous green.
  if (filter) {
    for (const name of filter) {
      const entry = SERVICES[name];
      if (!entry) {
        throw new Error(
          `unknown service "${name}" (not in SSOT). Run \`bin/showcase services\` to list known names.`,
        );
      }
      if (!entry.probe[opts.env]) {
        throw new Error(
          `service "${name}" is not probe-eligible for env "${opts.env}" (probe.${opts.env}=false in SSOT)`,
        );
      }
    }
  }
  for (const [name, entry] of Object.entries(SERVICES)) {
    if (filter && !filter.has(name)) continue;
    if (!entry.probe[opts.env]) continue;
    const overrideDomains = opts.overrides?.[name]?.domains;
    const rawHost = overrideDomains
      ? overrideDomains[opts.env]
      : domainFor(name, opts.env);
    if (!rawHost) {
      throw new Error(
        `Service "${name}" is probe-required for env "${opts.env}" but is missing a ${opts.env} domain.`,
      );
    }
    // Brand at the verify-pipeline ingress so every downstream driver
    // receives a `Host` (not a raw `string`). On the normal path
    // `domainFor` already enforces scheme + empty checks, and `asHost`
    // re-validates those (cheap redundancy). The checks that ONLY exist
    // here — path/slash, leading/trailing whitespace, `@`/`?`/`#` — are
    // mandatory because the override seam below (`overrideDomains`,
    // test-only) bypasses `domainFor` entirely; `asHost` is the sole
    // gate that catches those for both paths.
    const host = asHost(rawHost);
    targets.push({ name, host, driver: entry.probe.driver });
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

export interface VerifyOpts {
  env: EnvName;
  services?: string[];
  runner?: ProbeRunner;
}

export interface VerifySummary {
  env: EnvName;
  passed: Array<{ name: string }>;
  failed: Array<{ name: string; error: string }>;
  exitCode: number;
}

export async function runVerify(opts: VerifyOpts): Promise<VerifySummary> {
  const targets = resolveProbeTargets({
    env: opts.env,
    services: opts.services,
  });
  const runner = opts.runner ?? runDriver;
  const passed: Array<{ name: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];

  // Zero-targets is NEVER a success. A verify gate that prints
  // "targets=0" and exits 0 is the worst outcome — a vacuous green.
  // Fail loud with a clear diagnostic so the operator knows the run
  // verified nothing.
  if (targets.length === 0) {
    const error =
      `no probe-required services resolved for env "${opts.env}" — ` +
      `check --services and SSOT probe flags`;
    process.stdout.write(`verify-deploy --env=${opts.env} targets=0 (FAIL)\n`);
    process.stdout.write(`  ${error}\n`);
    return {
      env: opts.env,
      passed,
      failed: [{ name: "(zero-targets)", error }],
      exitCode: 1,
    };
  }

  process.stdout.write(
    `verify-deploy --env=${opts.env} targets=${targets.length}\n`,
  );

  for (const target of targets) {
    process.stdout.write(`  ${target.name.padEnd(36)} ${target.host} `);
    try {
      const outcome = await runner(target);
      if (outcome.ok) {
        passed.push({ name: target.name });
        process.stdout.write("OK\n");
      } else {
        failed.push({ name: target.name, error: outcome.error });
        process.stdout.write(`FAIL: ${outcome.error}\n`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ name: target.name, error: msg });
      process.stdout.write(`FAIL (threw): ${msg}\n`);
    }
  }

  return {
    env: opts.env,
    passed,
    failed,
    exitCode: failed.length === 0 ? 0 : 1,
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const summary = await runVerify(parsed);
  if (summary.failed.length > 0) {
    process.stderr.write(
      `\n${summary.failed.length} service(s) failed verify in ${summary.env}:\n`,
    );
    for (const f of summary.failed) {
      process.stderr.write(`  - ${f.name}: ${f.error}\n`);
    }
  }
  process.exit(summary.exitCode);
}

const isMain = process.argv[1]?.endsWith("verify-deploy.ts");
if (isMain) {
  main().catch((e) => {
    process.stderr.write(
      `verify-deploy crashed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
  });
}

export type { ProbeRunner } from "./verify-deploy.drivers";
