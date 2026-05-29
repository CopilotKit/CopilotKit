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

import { runDriver, type ProbeRunner } from "./verify-deploy.drivers";
import {
    SERVICES,
    domainFor,
    resolveEnv,
    type EnvName,
    type ProbeDriver,
} from "./railway-envs";

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
            envRaw = argv[++i];
        } else if (a.startsWith("--env=")) {
            envRaw = a.slice("--env=".length);
        } else if (a === "--services") {
            const v = argv[++i];
            if (!v) throw new Error("--services requires a CSV value");
            services = v.split(",").map((s) => s.trim()).filter(Boolean);
        } else if (a.startsWith("--services=")) {
            const v = a.slice("--services=".length);
            if (!v) throw new Error("--services requires a CSV value");
            services = v.split(",").map((s) => s.trim()).filter(Boolean);
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

export interface ProbeTarget {
    name: string;
    host: string;
    driver: ProbeDriver;
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
        const host = overrideDomains
            ? overrideDomains[opts.env]
            : domainFor(name, opts.env);
        if (!host) {
            throw new Error(
                `Service "${name}" is probe-required for env "${opts.env}" but is missing a ${opts.env} domain.`,
            );
        }
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
        process.stdout.write(
            `verify-deploy --env=${opts.env} targets=0 (FAIL)\n`,
        );
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
