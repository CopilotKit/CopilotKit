/**
 * D5 — script registry.
 *
 * The D5 driver (`drivers/e2e-deep.ts`) discovers per-feature scripts at
 * runtime by scanning `src/probes/scripts/d5-*.{js,ts}` and invoking each
 * file's top-level `registerD5Script(...)` call. The registry maps a
 * `D5FeatureType` to the script that owns it.
 *
 * Why a registry (not static imports):
 *   - Wave 2b ships 6 feature scripts in parallel, one per agent. Static
 *     imports would force all six files to exist before the driver
 *     compiles. With the registry pattern the driver lives independently
 *     of the script set; the dynamic loader picks up whatever scripts
 *     exist on disk and the registry collects them by feature type.
 *
 * A single registered `D5Script` may claim multiple feature types (e.g.
 * one shared-state script covering both `shared-state-read` and
 * `shared-state-write`, or one mcp-subagents script covering both
 * `mcp-apps` and `subagents`). Registration loops `featureTypes` and
 * writes one map entry per type; double-registration of the same
 * featureType throws so script-file collisions surface loudly at boot
 * rather than racing on which one wins.
 */

import type { ConversationTurn } from "./conversation-runner.js";

/**
 * Closed enum of D5 feature types. Wave 2b script authors must use one
 * of these literals when populating `D5Script.featureTypes`. Adding a
 * new feature type is a deliberate registry change — a script that
 * registers an unknown literal is a TypeScript error, not silently
 * accepted.
 */
export type D5FeatureType =
  | "agentic-chat"
  | "tool-rendering"
  | "shared-state-read"
  | "shared-state-write"
  | "hitl-approve-deny"
  | "hitl-text-input"
  | "gen-ui-headless"
  | "gen-ui-custom"
  | "mcp-apps"
  | "subagents";

/**
 * Closed-set runtime mirror of `D5FeatureType`. Kept in lock-step with
 * the type union so a TypeScript error fires if the two drift apart
 * (the `satisfies` constraint forces this list to remain a superset
 * of the union).
 */
const D5_FEATURE_TYPES: readonly D5FeatureType[] = [
  "agentic-chat",
  "tool-rendering",
  "shared-state-read",
  "shared-state-write",
  "hitl-approve-deny",
  "hitl-text-input",
  "gen-ui-headless",
  "gen-ui-custom",
  "mcp-apps",
  "subagents",
] as const satisfies readonly D5FeatureType[];

/**
 * Runtime type guard for `D5FeatureType`. Use this to validate
 * untrusted strings (CLI args, env vars, JSON) BEFORE handing them to
 * registry-aware code that types its parameters as `D5FeatureType`.
 *
 * Replaces ad-hoc `value as D5FeatureType` casts that would let an
 * unknown string slip past the type system and silently mismatch
 * against an empty registry.
 */
export function isD5FeatureType(value: unknown): value is D5FeatureType {
  return (
    typeof value === "string" &&
    (D5_FEATURE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Build context handed to `D5Script.buildTurns`. Scripts use this to
 * customise their conversation per-integration / per-feature without
 * having to import the driver itself. `baseUrl` is the integration's
 * publicly-reachable URL (e.g. `https://showcase-langgraph-python.example.com`)
 * so a script that needs to assert against a specific page in the same
 * conversation can compose absolute URLs.
 */
export interface D5BuildContext {
  integrationSlug: string;
  featureType: D5FeatureType;
  baseUrl: string;
}

/**
 * D5 script contract. One file under `src/probes/scripts/d5-<name>.ts`
 * exports a top-level `registerD5Script(...)` call with this shape.
 *
 *   - `featureTypes`: every feature this script claims. Multiple entries
 *     mean the same conversation works for >1 feature (e.g. shared-state
 *     read+write).
 *   - `fixtureFile`: basename under `showcase/ops/fixtures/d5/` that the
 *     conversation expects. Reference only — the runtime fixture wiring
 *     happens elsewhere (showcase-aimock loads the file). The driver
 *     surfaces this on the side row's signal so the dashboard can link
 *     directly to the canonical fixture for triage.
 *   - `buildTurns`: produces the per-tick conversation turn list. Called
 *     once per (integration, featureType) pair; the script may branch on
 *     `ctx.integrationSlug` if the conversation differs by integration.
 *   - `preNavigateRoute`: optional override for the URL path the driver
 *     navigates to. Default is `/demos/<featureType>`. Scripts where the
 *     showcase exposes the feature under a different route id (e.g.
 *     `mcp-apps` → `/demos/subagents`) override here.
 */
export interface D5Script {
  featureTypes: D5FeatureType[];
  fixtureFile: string;
  buildTurns: (ctx: D5BuildContext) => ConversationTurn[];
  preNavigateRoute?: (featureType: D5FeatureType) => string;
}

/**
 * Module-level registry. Keyed by feature type. `Map.get` returns
 * `undefined` for unregistered features — the driver treats that as
 * "skip this feature" and emits a `state: "skipped"` (mapped to green
 * with a `note`) per spec.
 *
 * Mutable on purpose: the dynamic loader populates this map at boot and
 * tests reset it via `__clearD5RegistryForTesting`.
 */
export const D5_REGISTRY: Map<D5FeatureType, D5Script> = new Map();

/**
 * Register a D5 script. Throws `Error` on double-registration of any
 * featureType so script-file collisions surface at boot rather than
 * silently dropping one of the conflicting scripts.
 *
 * Wave 2b script files invoke this at module top-level; the dynamic
 * loader's `await import(...)` triggers the registration as a side
 * effect of the import.
 */
export function registerD5Script(script: D5Script): void {
  if (script.featureTypes.length === 0) {
    throw new Error(
      "registerD5Script: featureTypes must contain at least one entry",
    );
  }
  // Validate ALL featureTypes upfront so a collision on (e.g.) the
  // second entry doesn't leave the first one half-registered. Without
  // this two-pass approach, a script with `featureTypes: ["a", "b"]`
  // where `b` collides would still register `a` before throwing — the
  // registry would then be in a partial state where the failed script
  // is partially "won".
  for (const featureType of script.featureTypes) {
    if (D5_REGISTRY.has(featureType)) {
      throw new Error(
        `registerD5Script: featureType "${featureType}" already registered (fixtureFile: "${script.fixtureFile}")`,
      );
    }
  }
  for (const featureType of script.featureTypes) {
    D5_REGISTRY.set(featureType, script);
  }
}

/**
 * Look up a script for a feature type. Returns `undefined` when no
 * script has registered the feature — driver maps that to a skipped
 * row.
 */
export function getD5Script(featureType: D5FeatureType): D5Script | undefined {
  return D5_REGISTRY.get(featureType);
}

/**
 * Test-only helper: empty the registry so each test starts fresh. NOT
 * exported through the package barrel; tests reach in directly.
 */
export function __clearD5RegistryForTesting(): void {
  D5_REGISTRY.clear();
}
