import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, test } from "vitest";
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

it("real CLI preserves unknown-service failures in stdout", () => {
  const records = join(directory, "records.json");
  writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));

  const result = runCli(inventory, records);

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.failures).toEqual([
    {
      code: "unknown-service",
      message: "service has no exact permanent or disposable ownership match",
      serviceId: temporary.serviceId,
      environmentId: temporary.environmentId,
    },
  ]);
  expect(output.services).toEqual([
    { ...temporary, classification: "unknown" },
  ]);
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

it.each([
  { label: "undefined", image: undefined },
  { label: "number", image: 42 },
  { label: "zero", image: 0 },
  { label: "object", image: {} },
  { label: "array", image: [] },
  { label: "boolean", image: false },
])(
  "rejects an inventory image of type $label",
  async ({ image: inputImage }) => {
    const records = join(directory, "records.json");
    writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
    await expect(
      classifyInventoryPayload(
        { ...inventory, services: [{ ...temporary, image: inputImage }] },
        records,
        now,
      ),
    ).rejects.toThrow("Invalid lifecycle inventory image");
  },
);

it("rejects an absent inventory image instead of treating it as null", async () => {
  const records = join(directory, "records.json");
  writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
  await expect(
    classifyInventoryPayload(
      {
        ...inventory,
        services: [
          {
            name: temporary.name,
            serviceId: temporary.serviceId,
            environmentId: temporary.environmentId,
          },
        ],
      },
      records,
      now,
    ),
  ).rejects.toThrow("Invalid lifecycle inventory fields");
});

it.each([
  { label: "null", image: null },
  { label: "empty string", image: "" },
  { label: "string", image },
])(
  "preserves an explicit $label inventory image",
  async ({ image: inputImage }) => {
    const records = join(directory, "records.json");
    writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
    const service = {
      ...temporary,
      name: "aimock",
      serviceId: SERVICES.aimock.serviceId,
      image: inputImage,
    };
    const result = await classifyInventoryPayload(
      { ...inventory, services: [service] },
      records,
      now,
    );
    expect(result).toEqual({
      services: [{ ...service, classification: "permanent" }],
      diagnostics: [],
      failures: [],
      excludedServices: [],
      excludedEnvironments: [],
    });
  },
);

/** Create an actual hole so in-process validation cannot rely on JSON normalization. */
function sparseValues(value: unknown, mixed: boolean): unknown[] {
  const values = mixed ? [value] : [];
  values.length += 1;
  return values;
}

it.each([
  ["observedEnvironmentIds", false],
  ["observedEnvironmentIds", true],
  ["services", false],
  ["services", true],
] as const)(
  "rejects sparse bridge %s with mixed entries %s",
  async (field, mixed) => {
    const records = join(directory, "records.json");
    writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
    const input =
      field === "observedEnvironmentIds"
        ? {
            ...inventory,
            observedEnvironmentIds: sparseValues(STAGING_ENV_ID, mixed),
            services: [],
          }
        : { ...inventory, services: sparseValues(temporary, mixed) };
    await expect(classifyInventoryPayload(input, records, now)).rejects.toThrow(
      "Invalid lifecycle inventory arrays",
    );
  },
);

it.each([
  { ...inventory, observedEnvironmentIds: [], services: [] },
  {
    ...inventory,
    services: [
      { ...temporary, name: "aimock", serviceId: SERVICES.aimock.serviceId },
    ],
  },
])(
  "preserves dense or empty bridge inventory through JSON round trip %#",
  async (input) => {
    const records = join(directory, "records.json");
    writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
    const result = await classifyInventoryPayload(input, records, now);
    expect(result.failures).toEqual([]);
    expect(result.services).toHaveLength(input.services.length);
    expect(
      await classifyInventoryPayload(
        JSON.parse(JSON.stringify(input)),
        records,
        now,
      ),
    ).toEqual(result);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  },
);

/** Isolate real CLI aliases and their evidence without changing the parent process. */
function setupCliEntrypoint() {
  const root = mkdtempSync(join(tmpdir(), "lifecycle entrypoint "));
  const script = resolve(__dirname, "classify-railway-lifecycle.ts");
  const alias = join(root, "classifier alias.ts");
  const records = join(root, "records.json");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE: records,
  };
  delete env.FORCE_COLOR;
  symlinkSync(script, alias);
  writeFileSync(records, JSON.stringify({ schemaVersion: 1, runs: [] }));
  return {
    root,
    script,
    alias,
    records,
    run(entry: string, input: string) {
      return spawnSync(
        resolve(__dirname, "../../node_modules/.bin/tsx"),
        [entry],
        {
          input,
          encoding: "utf8",
          timeout: 10_000,
          env,
        },
      );
    },
    teardown() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test.each(["script", "alias"] as const)(
  "runs the classifier through its %s entrypoint",
  (entry) => {
    const fixture = setupCliEntrypoint();
    const input = JSON.stringify({
      ...inventory,
      services: [
        { ...temporary, name: "aimock", serviceId: SERVICES.aimock.serviceId },
      ],
    });

    try {
      const result = fixture.run(fixture[entry], input);

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        services: [
          {
            name: "aimock",
            serviceId: SERVICES.aimock.serviceId,
            classification: "permanent",
          },
        ],
        failures: [],
        excludedServices: [],
      });
    } finally {
      fixture.teardown();
    }
  },
);

test.each(["absent", "missing", "directory", "other-file"] as const)(
  "imports without running the classifier with %s argv",
  (argv) => {
    const fixture = setupCliEntrypoint();
    const importer = join(fixture.root, "import-only.mjs");
    const entry =
      argv === "absent"
        ? undefined
        : argv === "missing"
          ? join(fixture.root, "missing.ts")
          : argv === "directory"
            ? fixture.root
            : importer;
    writeFileSync(
      importer,
      `process.argv = ${JSON.stringify(entry === undefined ? ["node"] : ["node", entry])};
import(${JSON.stringify(pathToFileURL(fixture.alias).href)}).then((module) => {
  if (typeof module.classifyInventoryPayload !== "function") throw new Error("Missing export");
  process.stdout.write(${JSON.stringify("import-only\n")});
});
`,
    );

    try {
      const result = fixture.run(importer, "malformed stdin must stay unread");

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("import-only\n");
    } finally {
      fixture.teardown();
    }
  },
);

test.each(["", "{"])(
  "rejects missing or malformed JSON through an alias: %j",
  (input) => {
    const fixture = setupCliEntrypoint();

    try {
      const result = fixture.run(fixture.alias, input);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Invalid lifecycle inventory JSON");
    } finally {
      fixture.teardown();
    }
  },
);
