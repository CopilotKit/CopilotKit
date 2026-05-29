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
        if (typeof status !== "string" || !VALID_STATUSES.has(status as BuildOutcome)) {
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
