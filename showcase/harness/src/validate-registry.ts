import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseRailwayLifecyclePolicy } from "./shared/railway-lifecycle.js";
import { readRailwayLifecycleEvidence } from "./shared/railway-lifecycle-records.js";

/** One-shot real reader for execution INSIDE the verified deployed harness image. */
export async function validateHarnessRegistry(
  expectedPolicy: string,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedPolicy))
    throw new Error("Expected policy digest required");
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.SHOWCASE_REGISTRY_CONSUMER !== "harness"
  )
    throw new Error("Deployed harness environment required");
  const endpoint = process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE;
  if (!endpoint?.startsWith("https://"))
    throw new Error("HTTPS registry binding required");
  const generated: unknown = JSON.parse(
    await readFile("/app/data/railway-envs.generated.json", "utf8"),
  );
  if (
    !generated ||
    typeof generated !== "object" ||
    !("disposableLifecyclePolicy" in generated)
  )
    throw new Error("Packaged policy missing");
  const parsed = parseRailwayLifecyclePolicy(
    generated.disposableLifecyclePolicy,
  );
  if (!parsed.ok) throw new Error("Packaged policy invalid");
  if (
    createHash("sha256").update(JSON.stringify(parsed.value)).digest("hex") !==
    expectedPolicy
  )
    throw new Error("Packaged policy differs from reviewed target");
  // Shared with normal Railway discovery: authenticates and validates snapshot,
  // then writes the real reader acknowledgement. No inventory or probes run.
  const result = await readRailwayLifecycleEvidence(
    endpoint,
    parsed.value,
    new Date(),
    AbortSignal.timeout(30_000),
  );
  if (result.status !== "valid")
    throw new Error("Harness registry reader refused activation");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error(
      "Usage: node dist/validate-registry.js EXPECTED_POLICY_SHA256",
    );
    process.exitCode = 1;
  } else {
    validateHarnessRegistry(process.argv[2]).then(
      () => console.log("Deployed harness registry validation passed"),
      () => {
        console.error(
          "Deployed harness registry validation failed; retain drain",
        );
        process.exitCode = 1;
      },
    );
  }
}
