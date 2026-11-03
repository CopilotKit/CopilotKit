#!/usr/bin/env node
/** Read-only Ruby promotion bridge; stdout contains only classifier results. */
import { readFileSync, realpathSync } from "node:fs";
import {
  classifyRailwayInventory,
  isDenseArray,
  parseRailwayLifecyclePolicy,
} from "../harness/src/shared/railway-lifecycle";
import type {
  ObservedRailwayService,
  RailwayInventoryClassification,
  RailwayLifecyclePolicy,
} from "../harness/src/shared/railway-lifecycle";
import { readRailwayLifecycleEvidence } from "../harness/src/shared/railway-lifecycle-records";
import { DISPOSABLE_LIFECYCLE_POLICY } from "./railway-envs";

/** Accept only inventory fields, never caller-provided policy or exclusions. */
function exactObject(input: unknown, keys: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    throw new Error("Invalid lifecycle inventory fields");
  return input as Record<string, unknown>;
}

/** Require explicit identities rather than coercing absent snapshot fields. */
function identity(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input !== input.trim())
    throw new Error("Invalid lifecycle inventory identity");
  return input;
}

/** Classify minimal observations with operator evidence and separately reviewed policy. */
export async function classifyInventoryPayload(
  input: unknown,
  recordsFile: string | undefined = process.env
    .SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE,
  now = new Date(),
  policy: RailwayLifecyclePolicy = DISPOSABLE_LIFECYCLE_POLICY,
): Promise<RailwayInventoryClassification> {
  const data = exactObject(input, [
    "projectId",
    "observedEnvironmentIds",
    "services",
  ]);
  const projectId = identity(data.projectId);
  if (
    !isDenseArray(data.observedEnvironmentIds) ||
    !isDenseArray(data.services)
  )
    throw new Error("Invalid lifecycle inventory arrays");
  const observedEnvironmentIds = data.observedEnvironmentIds.map(identity);
  const services: ObservedRailwayService[] = data.services.map(
    (inputService) => {
      const service = exactObject(inputService, [
        "name",
        "serviceId",
        "environmentId",
        "image",
      ]);
      if (service.image !== null && typeof service.image !== "string")
        throw new Error("Invalid lifecycle inventory image");
      return {
        name: identity(service.name),
        serviceId: identity(service.serviceId),
        environmentId: identity(service.environmentId),
        image: service.image,
      };
    },
  );
  if (
    new Set(observedEnvironmentIds).size !== observedEnvironmentIds.length ||
    services.some(
      (service) => !observedEnvironmentIds.includes(service.environmentId),
    ) ||
    new Set(
      services.map((service) =>
        JSON.stringify([service.environmentId, service.serviceId]),
      ),
    ).size !== services.length
  )
    throw new Error("Invalid lifecycle inventory scope or duplicate identity");
  const parsedPolicy = parseRailwayLifecyclePolicy(policy);
  if (!parsedPolicy.ok || projectId !== policy.projectId)
    throw new Error("Invalid lifecycle policy or inventory project");
  const evidence = await readRailwayLifecycleEvidence(
    recordsFile,
    parsedPolicy.value,
    now,
  );
  if (evidence.status === "invalid")
    throw new Error(
      evidence.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; "),
    );
  return classifyRailwayInventory({
    policy: parsedPolicy.value,
    evidence,
    now,
    projectId,
    observedEnvironmentIds,
    services,
  });
}

/** Read stdin without printing its contents, which are not diagnostic material. */
async function main(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    throw new Error("Invalid lifecycle inventory JSON");
  }
  const result = await classifyInventoryPayload(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/** Match aliases to the CLI source while keeping imports with synthetic argv inert. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(new URL(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `classify-railway-lifecycle: ${error instanceof Error ? error.message : "classification failed"}\n`,
    );
    process.exitCode = 1;
  });
}
