/**
 * Fleet role configuration: the single harness image boots in one of two
 * runtime ROLES, selected by env. This module is the ONE place that parses and
 * validates the role-selection env so the orchestrator entrypoint (and the
 * future control-plane/worker modules) share a single, typed contract.
 *
 *   HARNESS_ROLE       = "control-plane" | "worker"
 *   HARNESS_POOL_COUNT = positive integer (default 1)
 *
 * Mirrors the harness env-parsing idiom (`resolve*` helpers with explicit-arg >
 * env > default precedence, parseInt + Number.isNaN guards — see
 * `probes/helpers/browser-pool.ts`'s `resolveNonNegative`/`resolvePositive`).
 *
 * Fail-loud discipline: a missing, empty/whitespace, or explicitly-SET-but-
 * invalid HARNESS_ROLE (and likewise an invalid HARNESS_POOL_COUNT) throws on
 * boot rather than silently defaulting, so a misconfigured fleet member dies
 * immediately (visible in deploy CI / Railway health-check) instead of booting
 * in the wrong role hours before anyone notices. There is NO default role: an
 * UNSET HARNESS_ROLE throws so a poolless control-plane that runs no probes can
 * never boot by accident — every fleet service must declare its role.
 */

/** The two runtime roles the single harness image can boot as. */
export type HarnessRole = "control-plane" | "worker";

/** The valid HARNESS_ROLE string values, in a single source of truth. */
export const HARNESS_ROLES: readonly HarnessRole[] = [
  "control-plane",
  "worker",
] as const;

/** Default worker count the control-plane expects when unset (local). */
export const DEFAULT_POOL_COUNT = 1;

/** Typed, validated fleet role config — the output of env resolution. */
export interface FleetRoleConfig {
  /** Selected runtime role. */
  readonly role: HarnessRole;
  /**
   * Number of WORKER members in the fleet. The control-plane uses this to know
   * how many workers to expect; a worker carries it for symmetry/diagnostics.
   * Always >= 1.
   */
  readonly poolCount: number;
}

export interface ResolveFleetRoleOptions {
  /** Env source (defaults to process.env) — injectable for tests. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** Type guard: is `value` a valid HARNESS_ROLE string? */
export function isHarnessRole(value: string | undefined): value is HarnessRole {
  return (
    value !== undefined && (HARNESS_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Resolve HARNESS_POOL_COUNT to a positive integer.
 *
 * Precedence: env > default. Unlike the browser-pool's `resolveNonNegative`
 * (which tolerates garbage by falling back), an explicitly-SET-but-invalid
 * value (non-integer, < 1, or non-numeric) is a misconfiguration that must be
 * caught loudly — so it THROWS rather than silently defaulting. An UNSET value
 * legitimately defaults to `fallback`.
 */
function resolvePoolCount(
  envRaw: string | undefined,
  fallback: number,
): number {
  if (envRaw === undefined || envRaw.trim() === "") return fallback;
  const trimmed = envRaw.trim();
  // parseInt("2abc") === 2 silently — require the WHOLE string to be a base-10
  // integer so a fat-fingered value fails loud instead of being truncated.
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(
      `HARNESS_POOL_COUNT must be a positive integer, got "${envRaw}".`,
    );
  }
  const parsed = parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(
      `HARNESS_POOL_COUNT must be a positive integer (>= 1), got "${envRaw}".`,
    );
  }
  return parsed;
}

/**
 * Parse + validate the fleet role-selection env into a typed config.
 *
 * - HARNESS_ROLE is REQUIRED and must be one of HARNESS_ROLES. There is no
 *   default: a missing or empty/whitespace value throws (fail loud) so a
 *   poolless, probe-less control-plane can never boot by accident.
 * - HARNESS_POOL_COUNT defaults to DEFAULT_POOL_COUNT (1) and validates >= 1.
 *
 * Throws a clear, actionable Error on any missing/invalid input.
 */
export function resolveFleetRoleConfig(
  options: ResolveFleetRoleOptions = {},
): FleetRoleConfig {
  const env = options.env ?? process.env;

  const rawRole = env.HARNESS_ROLE?.trim();
  let role: HarnessRole;
  if (rawRole === undefined || rawRole === "") {
    throw new Error(
      `HARNESS_ROLE must be set to one of: ${HARNESS_ROLES.join(", ")} ` +
        `(got: <unset>). Every fleet service must set HARNESS_ROLE explicitly.`,
    );
  } else if (isHarnessRole(rawRole)) {
    role = rawRole;
  } else {
    throw new Error(
      `HARNESS_ROLE "${rawRole}" is invalid. Must be one of: ${HARNESS_ROLES.join(", ")}.`,
    );
  }

  const poolCount = resolvePoolCount(
    env.HARNESS_POOL_COUNT,
    DEFAULT_POOL_COUNT,
  );

  return { role, poolCount };
}
