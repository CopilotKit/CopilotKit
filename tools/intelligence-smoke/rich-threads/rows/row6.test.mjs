import assert from "node:assert/strict";
import test from "node:test";
import { row } from "./row6.mjs";

function context(mutate = () => {}) {
  const native = [
    {
      sourceId: "native-a",
      logical: {
        messages: [{ text: "rich" }],
        state: { todo: 1 },
        pending: { id: "pause" },
        media: { bytes: "AA==", name: "file.wav" },
      },
    },
  ];
  const destination = { threads: [] };
  let imports = 0;
  const artifacts = {};
  return {
    fixture: {
      sourceIds: ["native-a"],
      nativeThreadIds: { "native-a": "native-a" },
      continuationSourceIds: ["native-a"],
    },
    writeArtifact: async (name, value) => {
      artifacts[name] = structuredClone(value);
    },
    artifacts,
    services: {
      importSafety: {
        snapshotSource: async () => native,
        snapshotDestination: async () => destination,
        import: async () => {
          imports++;
          if (imports === 1)
            destination.threads.push({
              id: "dest-a",
              sourceId: "native-a",
              messages: [{ id: "m1", role: "user", content: "rich" }],
              events: [{ id: "e1", type: "RUN_STARTED" }],
              state: { todo: 1 },
            });
          const result = {
            pathIdentity: "built-cli-sha256",
            results: [
              {
                sourceId: "native-a",
                status: imports === 1 ? "imported" : "skipped",
                destinationId: "dest-a",
                reason: imports === 1 ? undefined : "already_imported",
              },
            ],
          };
          mutate({ native, destination, imports, result });
          return result;
        },
        continueImported: async () => {
          native[0].logical.messages.push({ text: "continued" });
          destination.threads[0].messages.push(
            { id: "m2", role: "user", content: "follow up" },
            { id: "m3", role: "assistant", content: "continued" },
          );
          destination.threads[0].events.push({
            id: "e2",
            type: "RUN_FINISHED",
          });
          destination.threads[0].state.todo = 2;
        },
      },
    },
  };
}

test("compares initial, repeat and continued baselines; missing coverage stays unvalidated", async () => {
  const input = context();
  const result = await row.run(input);
  assert.equal(result.status, "unvalidated");
  assert.equal(
    result.checks.filter((check) => check.status === "passed").length,
    4,
  );
  assert.equal(
    input.artifacts["before-import.json"].destination.threads.length,
    0,
  );
  assert.equal(
    input.artifacts["after-initial.json"].destination.threads[0].state.todo,
    1,
  );
  assert.equal(
    input.artifacts["after-post-continuation-repeat.json"].destination
      .threads[0].state.todo,
    2,
  );
});

for (const [name, mutate, error] of [
  [
    "initial native media mutation",
    ({ imports, native }) => {
      if (imports === 1) native[0].logical.media.name = "lost.wav";
    },
    /Initial import mutated/,
  ],
  [
    "repeat native pending mutation",
    ({ imports, native }) => {
      if (imports === 2) native[0].logical.pending.id = "wrong";
    },
    /mutated native/,
  ],
  [
    "duplicate destination",
    ({ imports, destination }) => {
      if (imports === 2)
        destination.threads.push({
          ...destination.threads[0],
          id: "duplicate",
        });
    },
    /duplicated, erased/,
  ],
  [
    "same-count payload corruption",
    ({ imports, destination }) => {
      if (imports === 2) destination.threads[0].messages[0].content = "corrupt";
    },
    /duplicated, erased/,
  ],
  [
    "event reorder",
    ({ imports, destination }) => {
      if (imports === 3) destination.threads[0].events.reverse();
    },
    /duplicated, erased/,
  ],
  [
    "continuation rewind",
    ({ imports, destination }) => {
      if (imports === 3) destination.threads[0].messages.splice(1);
    },
    /duplicated, erased/,
  ],
  [
    "state rewind",
    ({ imports, destination }) => {
      if (imports === 3) destination.threads[0].state.todo = 1;
    },
    /duplicated, erased/,
  ],
  [
    "skip is not conflict",
    ({ imports, result }) => {
      if (imports === 2) result.results[0].reason = "IMPORT_NATIVE_ID_CONFLICT";
    },
    /Non-idempotent skip/,
  ],
  [
    "changed built path",
    ({ imports, result }) => {
      if (imports === 2) result.pathIdentity = "other";
    },
    /Import path changed/,
  ],
  [
    "missing per-source outcome",
    ({ result }) => {
      result.results = [];
    },
    /Missing import outcome/,
  ],
])
  test(`rejects ${name}`, async () => {
    await assert.rejects(row.run(context(mutate)), error);
  });

test("refuses an already connected selected source before importer runs", async () => {
  const input = context();
  input.services.importSafety.snapshotDestination = async () => ({
    threads: [
      {
        id: "native-a",
        sourceId: "native-a",
        messages: [],
        events: [],
        state: {},
      },
    ],
  });
  await assert.rejects(row.run(input), /Source already connected/);
});

test("mixed-store collision remains separately recorded", async () => {
  const input = context(({ result }) =>
    result.results.push({
      sourceId: "connected",
      status: "conflict",
      reason: "IMPORT_NATIVE_ID_CONFLICT",
    }),
  );
  await row.run(input);
  assert.equal(
    input.artifacts["repeat-import.json"].results[1].status,
    "conflict",
  );
});

test("absence checks original native ID even without import metadata", async () => {
  const input = context();
  input.fixture.nativeThreadIds["native-a"] = "original-session";
  input.services.importSafety.snapshotDestination = async () => ({
    threads: [
      {
        id: "original-session",
        sourceId: "connected-source",
        messages: [],
        events: [],
        state: {},
      },
    ],
  });
  await assert.rejects(row.run(input), /Source already connected/);
});

test("shared runner preserves incomplete coverage verdict", async () => {
  const { aggregate } = await import("../contract.mjs");
  const input = context();
  delete input.services.importSafety.continueImported;
  const result = await row.run(input);
  assert.equal(aggregate(result.checks), "unvalidated");
  assert.equal(result.status, aggregate(result.checks));
});

test("rejects continuation that writes a different native session", async () => {
  const input = context();
  const original = input.services.importSafety.snapshotSource;
  const frozen = structuredClone(await original());
  input.services.importSafety.snapshotSource = async () => frozen;
  await assert.rejects(
    row.run(input),
    /Continuation did not reach original native source/,
  );
});

test("requires every declared rich source to continue", async () => {
  const input = context();
  input.fixture.continuationSourceIds = ["unknown"];
  await assert.rejects(
    row.run(input),
    /Declare selected rich continuation source IDs/,
  );
});

test("does not downgrade a demonstrated category failure to missing coverage", async () => {
  const input = context();
  input.fixture.importSafetyCoverage = [
    {
      category: "audio:data",
      status: "failed",
      evidence: ["native.json"],
      detail: "Native audio payload is missing",
    },
  ];
  const result = await row.run(input);
  assert.equal(result.status, "failed");
});
