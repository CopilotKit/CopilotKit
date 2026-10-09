import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { classifyInventoryPayload } from "./classify-railway-lifecycle";
import {
  DISPOSABLE_LIFECYCLE_POLICY,
  PROJECT_ID,
  STAGING_ENV_ID,
  SERVICES,
} from "./railway-envs";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lifecycle bridge "));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
const now = new Date("2026-10-08T12:15:00Z");
const image = `ghcr.io/fixture/nested/app@sha256:${"a".repeat(64)}`;
const temporary = {
  name: "fixture-run",
  serviceId: "fixture-service",
  environmentId: STAGING_ENV_ID,
  image,
};
const inventory = {
  projectId: PROJECT_ID,
  observedEnvironmentIds: [STAGING_ENV_ID],
  services: [temporary],
};

it("classifies exact owned services using evidence and a separately approved policy", async () => {
  const records = join(directory, "records.json");
  writeFileSync(
    records,
    JSON.stringify({
      schemaVersion: 1,
      runs: [
        {
          runId: "fixture-run",
          projectId: PROJECT_ID,
          environmentId: STAGING_ENV_ID,
          startedAt: "2026-10-08T12:00:00Z",
          expiresAt: "2026-10-08T13:00:00Z",
          phase: "ready",
          services: [
            {
              name: temporary.name,
              serviceId: temporary.serviceId,
              expectedImage: image,
            },
          ],
          resources: [],
        },
      ],
    }),
  );
  const result = await classifyInventoryPayload(inventory, records, now, {
    ...DISPOSABLE_LIFECYCLE_POLICY,
    approvedImages: [image],
  });
  expect(result.excludedServices).toEqual([
    {
      projectId: PROJECT_ID,
      environmentId: STAGING_ENV_ID,
      serviceId: temporary.serviceId,
    },
  ]);
  expect(result.failures).toEqual([]);
});

it("does not trust caller-supplied exclusions or policy", async () => {
  await expect(
    classifyInventoryPayload({ ...inventory, excludedServices: [temporary] }),
  ).rejects.toThrow(/inventory/);
});

/** Execute the same local binary and stdin protocol used by Ruby, without credentials. */
function runCli(input: unknown, records: string) {
  return spawnSync(
    resolve(__dirname, "../../node_modules/.bin/tsx"),
    [resolve(__dirname, "classify-railway-lifecycle.ts")],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE: records },
    },
  );
}

it("real CLI reads explicit empty evidence and emits the shared classifier JSON", () => {
  const records = join(directory, "records.json");
  writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
  const result = runCli(
    {
      ...inventory,
      services: [
        { ...temporary, name: "aimock", serviceId: SERVICES.aimock.serviceId },
      ],
    },
    records,
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).services[0].classification).toBe(
    "permanent",
  );
  expect(JSON.parse(result.stdout).excludedServices).toEqual([]);
});

it("real CLI rejects configured missing evidence visibly with no authorization output", () => {
  const result = runCli(inventory, join(directory, "missing.json"));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/records-unreadable/);
  expect(result.stdout).toBe("");
});

it.each([
  { ...inventory, projectId: "foreign-project" },
  { ...inventory, services: [{ ...temporary, serviceId: "" }] },
  { ...inventory, services: [{ ...temporary, environmentId: "not-observed" }] },
  { ...inventory, services: [temporary, temporary] },
  {
    ...inventory,
    services: [{ ...temporary, env: { secret: "do-not-send" } }],
  },
])("rejects malformed or out-of-scope minimal inventory %#", async (input) => {
  await expect(classifyInventoryPayload(input)).rejects.toThrow(/inventory/);
});

it("real CLI does not accept exclusions supplied on stdin", () => {
  const records = join(directory, "records.json");
  writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
  const result = runCli(
    { ...inventory, excludedServices: [temporary] },
    records,
  );
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/Invalid lifecycle inventory fields/);
});
