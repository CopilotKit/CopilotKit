/**
 * build-outputs.ts — Parse + merge the structured per-slot build results
 * emitted by `showcase_build.yml`. Each matrix slot in the build job
 * uploads a per-slot artifact named `build-result-<dispatch_name>`
 * containing a single `result.json` payload of the shape
 * `{service: "<dispatch_name>", status: "success"|"failure"|"skipped"}`.
 * The aggregate-build-results job downloads every `build-result-*`
 * artifact and merges the payloads via `mergeBuildResultFiles` below;
 * the resulting array is uploaded as the canonical `build-results`
 * artifact for cross-workflow consumption. The deploy workflow (and the
 * redeploy guard) read this list instead of parsing job names.
 *
 * NOTE: the "single result.json per slot" invariant is enforced
 * workflow-side (each matrix slot writes exactly one file before
 * uploading its artifact); this module assumes that contract and
 * validates only the parsed payload shape, not the filesystem layout.
 */

// Single source of truth for the set of valid build outcomes. The
// `as const` tuple drives BOTH the runtime `VALID_STATUSES` set AND
// the compile-time `BuildOutcome` union (derived via indexed access
// below), so the tuple is the only place a status needs to be added.
// Since `BuildOutcome` is derived from this tuple there is no separate
// union that could drift out of sync — no redundant exhaustiveness
// assertion is needed.
const BUILD_OUTCOMES = ["success", "failure", "skipped"] as const;

export type BuildOutcome = (typeof BUILD_OUTCOMES)[number];

const VALID_STATUSES: ReadonlySet<BuildOutcome> = new Set(BUILD_OUTCOMES);

export interface ServiceBuildResult {
  service: string;
  status: BuildOutcome;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Shared validator for a single `{service, status}` payload. Used by
 * both `parseBuildOutputs` (per array entry) and `mergeBuildResultFiles`
 * (per slot payload) so validation rules + error wording live in one
 * place. `contextLabel` is prefixed to every error message — callers
 * pass something like `"parseBuildOutputs entry[3]"` or
 * `"mergeBuildResultFiles slot[2]"` so the failure points at the
 * offending row.
 */
function validateServiceBuildResult(
  raw: unknown,
  contextLabel: string,
): ServiceBuildResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `${contextLabel}: expected object with {service, status}, got ${JSON.stringify(raw)}`,
    );
  }
  const service = (raw as { service?: unknown }).service;
  if (typeof service !== "string") {
    throw new Error(
      `${contextLabel}: missing required string field "service": ${JSON.stringify(raw)}`,
    );
  }
  const trimmedService = service.trim();
  if (trimmedService.length === 0) {
    throw new Error(
      `${contextLabel}: field "service" must be a non-empty, non-whitespace string: ${JSON.stringify(raw)}`,
    );
  }
  const status = (raw as { status?: unknown }).status;
  if (
    typeof status !== "string" ||
    !VALID_STATUSES.has(status as BuildOutcome)
  ) {
    throw new Error(
      `${contextLabel}: invalid "status" (must be success|failure|skipped): ${JSON.stringify(raw)}`,
    );
  }
  return { service: trimmedService, status: status as BuildOutcome };
}

export function parseBuildOutputs(raw: string): ServiceBuildResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Failed to parse build outputs JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Build outputs must be a JSON array");
  }
  return parsed.map((entry, idx) =>
    validateServiceBuildResult(entry, `parseBuildOutputs entry[${idx}]`),
  );
}

export function successSet(results: ServiceBuildResult[]): string[] {
  return results.filter((r) => r.status === "success").map((r) => r.service);
}

/**
 * Canonical artifact-name convention for the per-slot build-result
 * handoff. Each matrix slot in showcase_build.yml uploads exactly one
 * artifact named `build-result-<dispatch_name>` containing a single
 * `result.json` file. The aggregator job downloads every artifact
 * matching the `build-result-*` pattern and merges them via
 * mergeBuildResultFiles below. We refuse empty/whitespace service
 * names so the per-slot artifact cannot collide with the aggregated
 * `build-results` artifact published downstream.
 */
export function buildResultArtifactName(service: string): string {
  if (!isNonBlankString(service)) {
    throw new Error(
      "buildResultArtifactName: `service` must be a non-empty, non-whitespace string",
    );
  }
  return `build-result-${service}`;
}

/**
 * Merge a list of per-slot result.json payloads (raw strings, one per
 * matrix slot's uploaded artifact) into a single ServiceBuildResult[].
 * Each payload MUST be a JSON object with `service: string` and
 * `status: success|failure|skipped`. The merge is order-preserving so
 * downstream consumers can rely on stable iteration.
 *
 * Fails loud on duplicate `service` names across slots: a duplicate
 * means an upstream dispatch-name collision (two slots claiming the
 * same service), which would let a `failure` + `success` pair for the
 * same service spuriously look like a success in `successSet`. We
 * surface the collision instead of silently deduping.
 */
export function mergeBuildResultFiles(
  slotPayloads: readonly string[],
): ServiceBuildResult[] {
  const merged = slotPayloads.map((raw, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `mergeBuildResultFiles slot[${idx}]: not valid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
        { cause: e },
      );
    }
    return validateServiceBuildResult(
      parsed,
      `mergeBuildResultFiles slot[${idx}]`,
    );
  });

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { service } of merged) {
    if (seen.has(service)) {
      duplicates.add(service);
    } else {
      seen.add(service);
    }
  }
  if (duplicates.size > 0) {
    const names = Array.from(duplicates).sort().join(", ");
    throw new Error(
      `mergeBuildResultFiles: duplicate service name(s) across slots: ${names}`,
    );
  }
  return merged;
}

/**
 * Returns true iff at least one service in the build set finished as
 * `success`. Gates redeploy: when no service succeeded, redeploy MUST
 * be skipped so we do not re-pull the stale `:latest` and silently
 * look healthy.
 */
export function shouldRedeployStaging(results: ServiceBuildResult[]): boolean {
  return results.some((r) => r.status === "success");
}
