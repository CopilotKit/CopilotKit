import { readFile } from "node:fs/promises";
import { parseRunRecordsSnapshot } from "./railway-lifecycle.js";
import type {
  LifecycleEvidence,
  RailwayLifecyclePolicy,
} from "./railway-lifecycle.js";

/**
 * Read one operator-configured atomic snapshot. The configured path is the trust
 * boundary: only the lifecycle writer/operator may publish it. Never infer an
 * empty snapshot from a configured read failure or expose file contents in errors.
 */
export async function readRailwayLifecycleEvidence(
  filePath: string | undefined,
  policy: RailwayLifecyclePolicy,
  now: Date,
): Promise<LifecycleEvidence> {
  if (filePath === undefined) return { status: "unavailable" };
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    return {
      status: "invalid",
      issues: [
        {
          code: "records-unreadable",
          message: "Configured lifecycle records file could not be read",
        },
      ],
    };
  }
  let input: unknown;
  try {
    input = JSON.parse(contents);
  } catch {
    return {
      status: "invalid",
      issues: [
        {
          code: "records-malformed-json",
          message: "Configured lifecycle records file is not valid JSON",
        },
      ],
    };
  }
  const parsed = parseRunRecordsSnapshot(input, policy, now);
  return parsed.ok
    ? { status: "valid", snapshot: parsed.value }
    : { status: "invalid", issues: parsed.issues };
}
