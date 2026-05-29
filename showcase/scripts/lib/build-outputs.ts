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
 */

export type BuildOutcome = "success" | "failure" | "skipped";

export interface ServiceBuildResult {
  service: string;
  status: BuildOutcome;
}

const VALID_STATUSES: ReadonlySet<BuildOutcome> = new Set([
  "success",
  "failure",
  "skipped",
]);

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
  const results: ServiceBuildResult[] = [];
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { service?: unknown }).service !== "string"
    ) {
      throw new Error(
        `Build outputs entry missing required string field "service": ${JSON.stringify(entry)}`,
      );
    }
    const status = (entry as { status?: unknown }).status;
    if (
      typeof status !== "string" ||
      !VALID_STATUSES.has(status as BuildOutcome)
    ) {
      throw new Error(
        `Build outputs entry has invalid "status" (must be success|failure|skipped): ${JSON.stringify(entry)}`,
      );
    }
    results.push({
      service: (entry as { service: string }).service,
      status: status as BuildOutcome,
    });
  }
  return results;
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
 * mergeBuildResultFiles below. We refuse empty service names so the
 * per-slot artifact cannot collide with the aggregated `build-results`
 * artifact published downstream.
 */
export function buildResultArtifactName(service: string): string {
  if (typeof service !== "string" || service.length === 0) {
    throw new Error(
      "buildResultArtifactName: `service` must be a non-empty string",
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
 */
export function mergeBuildResultFiles(
  slotPayloads: readonly string[],
): ServiceBuildResult[] {
  return slotPayloads.map((raw, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `mergeBuildResultFiles: slot[${idx}] is not valid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
        { cause: e },
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { service?: unknown }).service !== "string"
    ) {
      throw new Error(
        `mergeBuildResultFiles: slot[${idx}] missing required string field "service": ${raw}`,
      );
    }
    const status = (parsed as { status?: unknown }).status;
    if (
      typeof status !== "string" ||
      !VALID_STATUSES.has(status as BuildOutcome)
    ) {
      throw new Error(
        `mergeBuildResultFiles: slot[${idx}] has invalid "status" (must be success|failure|skipped): ${raw}`,
      );
    }
    return {
      service: (parsed as { service: string }).service,
      status: status as BuildOutcome,
    };
  });
}
