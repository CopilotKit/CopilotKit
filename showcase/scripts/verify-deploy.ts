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
import { SERVICES, domainFor, probeEnabled, resolveEnv } from "./railway-envs";
import type { EnvName, ProbeDriver } from "./railway-envs";

export interface ParsedArgs {
  env: EnvName;
  services?: string[];
  /**
   * When a `--services` filter names a service that exists in the SSOT but
   * is NOT probe-eligible for `--env` (`probe.<env>=false`), SKIP it with a
   * clear `N/A` status line instead of throwing. ON by default: a probe
   * target set legitimately mixes in services that are deployable but not
   * probe-eligible for the requested env (e.g. `harness-workers`, which is
   * `probe.staging=false` AND `probe.prod=false`, and the `starter-*` fleet
   * for staging). The verify gate probes only the eligible subset and never
   * crashes on an ineligible-but-known name. An UNKNOWN (non-SSOT) name is
   * STILL a hard error — a typo is a real fault, never a legitimate skip.
   *
   * `--strict-eligibility` flips this off, restoring the hard-refuse for any
   * known-but-ineligible name (useful when an operator wants an explicit
   * single-service probe to fail loud rather than no-op).
   */
  skipIneligible?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let envRaw: string | undefined;
  let services: string[] | undefined;
  // Skip-by-default: a known-but-ineligible service is a legitimate state
  // for the probe set (see ParsedArgs.skipIneligible), not a fault. The
  // verify-prod CI gate calls verify-deploy.ts directly with the promote
  // target set (which can include `harness-workers`, probe.prod=false), and
  // a hard-refuse there crashes the gate after a successful promote. Skipping
  // ineligible names — for ANY env — is the correct, composable default.
  let skipIneligible = true;
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
    } else if (a === "--skip-ineligible") {
      // Now the default (see `skipIneligible` init above). Still accepted as
      // an explicit no-op for back-compat with callers wired before the
      // default flipped (e.g. the promote staging precondition in
      // showcase_promote.yml passes it).
      skipIneligible = true;
    } else if (a === "--strict-eligibility") {
      // Opt OUT of skip-by-default: restore the hard-refuse for a
      // known-but-ineligible name. An UNKNOWN name is a hard error on
      // BOTH paths regardless.
      skipIneligible = false;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!envRaw) {
    throw new Error("--env is required (staging|prod)");
  }
  const { env } = resolveEnv(envRaw);
  const base: ParsedArgs = { env, skipIneligible };
  return services === undefined ? base : { ...base, services };
}

/**
 * Branded host type for `ProbeTarget.host`.
 *
 * A `Host` is a bare hostname literal (no scheme, no path, no slash) —
 * exactly the shape `domainFor()` is documented to return. The brand is
 * structural only: at runtime a `Host` IS a string, so it is assignable
 * to any `string`-typed parameter with no runtime cost. The point is to
 * prevent the inverse direction — a caller cannot hand a `ProbeTarget` a
 * scheme-included or path-bearing string without going through
 * `asHost()`, which validates fail-loud.
 *
 * The brand uses a non-exported `unique symbol`, so a stray
 * `"foo" as Host` cast from outside this module is a type error — the
 * brand symbol is not in scope. `asHost()` is the sole legitimate
 * constructor.
 *
 * Co-located with `ProbeTarget` (the only structural consumer) rather
 * than in `railway-envs.ts` to keep the brand at the verify-pipeline
 * boundary; `domainFor()` keeps its `string` return type and we validate
 * + brand at the point of ingress in `resolveProbeTargets`.
 */
declare const HostBrand: unique symbol;
export type Host = string & { readonly [HostBrand]: true };

/**
 * Validate + brand a bare hostname literal as a `Host`. Rejects, with a
 * precise diagnostic per case:
 *   - any scheme separator (`://`)
 *   - any slash (path component)
 *   - the empty string
 *   - leading/trailing whitespace
 *   - `@` (userinfo), `?` (query), `#` (fragment)
 *   - any ASCII control character (`\x00-\x1f`, `\x7f` — e.g. `\n`, `\r`)
 *   - any `:` character (typically a `:port` suffix — bare hostnames
 *     from `domainFor` never contain a colon; ports are not part of
 *     the contract)
 *   - any character outside the DNS-label charset `[A-Za-z0-9.-]`
 *     (positive shape check — rejects unicode, `_`, `!`, etc.)
 *
 * The verify-deploy pipeline never wants any of these — drivers always
 * build URLs as `https://${host}${path}`, so a host carrying any of
 * the above would produce malformed URLs at the driver boundary.
 *
 * Overlap with `domainFor()` is partial, not full: `domainFor` re-checks
 * scheme + empty on the normal SSOT path, but does NOT check path/slash
 * or the whitespace/userinfo/query/fragment/control/port/charset cases
 * that `asHost` rejects. The override seam in `resolveProbeTargets`
 * (test-only path that bypasses `domainFor` entirely) is what makes the
 * `asHost` call mandatory — it is the sole ingress that gets to skip
 * `domainFor`'s checks.
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
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(
      `asHost: host must not include control characters (got ${JSON.stringify(value)})`,
    );
  }
  // Port suffix: verify-pipeline hosts from `domainFor` are bare
  // hostnames. A `:port` here would produce `https://host:port/path`
  // — well-formed but outside the contract — so reject it loudly so
  // callers feed a bare hostname (the SSOT shape).
  if (value.includes(":")) {
    throw new Error(
      `asHost: host must not include a port suffix (got "${value}")`,
    );
  }
  // Positive DNS-label charset check. Anchored so any single invalid
  // character (space, `_`, unicode, etc.) is rejected. Combined with
  // the negative rules above, this leaves only `[A-Za-z0-9.-]+`.
  if (!/^[A-Za-z0-9.-]+$/.test(value)) {
    throw new Error(
      `asHost: host must match DNS-label charset [A-Za-z0-9.-] (got "${value}")`,
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
  /**
   * When true (the default — see `ParsedArgs.skipIneligible`), a
   * `--services` entry that is in the SSOT but not probe-eligible for `env`
   * (`probe.<env>=false`) is SKIPPED (with an `N/A` status line) rather than
   * throwing. Unknown (non-SSOT) names are STILL a hard error — a typo is a
   * real fault, not a legitimate skip.
   */
  skipIneligible?: boolean;
  /**
   * Test seam: shallow-merge a partial entry over the SSOT before resolve.
   * `domains` is keyed by env name (matches the open `EnvName`); callers
   * supply at least the env under test.
   */
  overrides?: Record<string, { domains?: Record<EnvName, string> }>;
}

export function resolveProbeTargets(opts: ResolveOpts): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  const filter = opts.services ? new Set(opts.services) : undefined;
  // Validate user-supplied service names against the SSOT BEFORE
  // filtering — a typo (`docss`) or a name that's not probe-eligible
  // for the target env must surface as a clear, distinct error, not a
  // silent zero-targets vacuous green.
  //
  // DEFAULT (opts.skipIneligible, on unless `--strict-eligibility`): a
  // probe target set legitimately mixes in services that are deployable but
  // NOT probe-eligible for the requested env — the verify-prod gate probes
  // the promoted set (which can include `harness-workers`, probe.prod=false),
  // and the staging precondition probes the FULL promote set (the starter-*
  // fleet carries probe.staging=false). For those callers a non-eligible
  // service is an expected state, not a fault, so SKIP it (with a clear `N/A`
  // status line) instead of crashing the gate. An UNKNOWN (non-SSOT) name
  // stays a hard error on BOTH paths — a typo is a real fault, never a skip.
  if (filter) {
    for (const name of filter) {
      const entry = SERVICES[name];
      if (!entry) {
        throw new Error(
          `unknown service "${name}" (not in SSOT). Run \`bin/showcase services\` to list known names.`,
        );
      }
      if (!probeEnabled(name, opts.env)) {
        if (opts.skipIneligible) {
          process.stdout.write(
            `  ${name.padEnd(36)} N/A — not probe-eligible for env ${opts.env} (probe.${opts.env}=false in SSOT), skipped\n`,
          );
          continue;
        }
        throw new Error(
          `service "${name}" is not probe-eligible for env "${opts.env}" (probe.${opts.env}=false in SSOT)`,
        );
      }
    }
  }
  for (const [name, entry] of Object.entries(SERVICES)) {
    if (filter && !filter.has(name)) continue;
    if (!probeEnabled(name, opts.env)) continue;
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
    // here — path/slash, leading/trailing whitespace, `@`/`?`/`#`,
    // control chars, port suffix, DNS-label charset — are mandatory
    // because the override seam above (`overrideDomains`, test-only)
    // bypasses `domainFor` entirely; `asHost` is the sole gate that
    // catches those for both paths.
    const host = asHost(rawHost);
    targets.push({ name, host, driver: entry.probeDriver });
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

export interface VerifyOpts {
  env: EnvName;
  services?: string[];
  /** See `ResolveOpts.skipIneligible` — forwarded to resolveProbeTargets. */
  skipIneligible?: boolean;
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
    skipIneligible: opts.skipIneligible,
  });
  const runner = opts.runner ?? runDriver;
  const passed: Array<{ name: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];

  // Zero-targets is normally NEVER a success — a verify gate that prints
  // "targets=0" and exits 0 is the worst outcome, a vacuous green — so it
  // fails loud.
  //
  // EXCEPTION: when an explicit `--services` filter was supplied and EVERY
  // named service is known-but-not-probe-eligible for this env (so they were
  // all legitimately skipped under skipIneligible), there is genuinely
  // nothing to probe. That is the verify-prod case when the promoted set is
  // entirely probe-ineligible services (e.g. just `harness-workers`): the
  // ineligible names were already validated as known in resolveProbeTargets,
  // so this is an expected no-op, not a fault. Exit 0 with a clear note.
  if (targets.length === 0) {
    const allRequestedIneligible =
      opts.skipIneligible === true &&
      opts.services !== undefined &&
      opts.services.length > 0 &&
      opts.services.every((name) => !probeEnabled(name, opts.env));
    if (allRequestedIneligible) {
      process.stdout.write(
        `verify-deploy --env=${opts.env} targets=0 — ` +
          `nothing to probe (all requested services are not probe-eligible ` +
          `for env ${opts.env}, skipped)\n`,
      );
      return { env: opts.env, passed, failed, exitCode: 0 };
    }
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
