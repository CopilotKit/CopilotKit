import assert from "node:assert/strict";
import { categories, aggregate, statuses } from "../contract.mjs";

// No framework-specific normalization: fixture adapters must return the complete
// durable logical record, including native sidecars and pending metadata.
const copy = (value) => structuredClone(value);

function unique(items, key, label) {
  assert(Array.isArray(items), `${label} must be an array`);
  const keys = items.map((item) => item[key]);
  assert(
    keys.every((id) => typeof id === "string" && id.length),
    `${label}: missing ${key}`,
  );
  assert.equal(new Set(keys).size, keys.length, `${label}: duplicate ${key}`);
}

function validateSnapshot(source, destination, ids) {
  unique(source, "sourceId", "native snapshots");
  for (const id of ids) {
    const native = source.find((item) => item.sourceId === id);
    assert(
      native && native.logical != null,
      `Missing full native record: ${id}`,
    );
  }
  unique(destination.threads, "id", "destination threads");
  for (const thread of destination.threads) {
    assert(Array.isArray(thread.messages), "Missing destination messages");
    assert(Array.isArray(thread.events), "Missing destination events");
    assert(Object.hasOwn(thread, "state"), "Missing destination state");
  }
}

function outcomes(result, ids, status) {
  assert.equal(
    typeof result.pathIdentity,
    "string",
    "Missing built import identity",
  );
  assert(result.pathIdentity.length, "Empty built import identity");
  unique(result.results, "sourceId", "import outcomes");
  for (const id of ids) {
    const item = result.results.find((entry) => entry.sourceId === id);
    assert(item, `Missing import outcome: ${id}`);
    assert.equal(
      item.status,
      status,
      `Unexpected selected-source outcome: ${id}`,
    );
    if (status === "skipped")
      assert.equal(
        item.reason,
        "already_imported",
        `Non-idempotent skip: ${id}`,
      );
    assert.equal(
      typeof item.destinationId,
      "string",
      `Missing destination identity: ${id}`,
    );
  }
  // A mixed-store connected collision is not a successful native-only skip.
  // Other failures must remain visible rather than disappearing into totals.
  for (const item of result.results.filter(
    (entry) => !ids.includes(entry.sourceId),
  )) {
    assert.equal(
      item.status,
      "conflict",
      "Unexpected unselected import outcome",
    );
    assert.equal(
      item.reason,
      "IMPORT_NATIVE_ID_CONFLICT",
      "Unknown mixed-store collision",
    );
  }
}

const summary = (snapshot) => ({
  nativeSources: snapshot.native.map((item) => item.sourceId),
  threads: snapshot.destination.threads.map((thread) => ({
    id: thread.id,
    sourceId: thread.sourceId,
    messages: thread.messages.length,
    events: thread.events.length,
  })),
});

export const row = {
  id: 6,
  title: "Repeat-import deduplication and native-source safety",
  async run(context) {
    const { fixture, services, writeArtifact } = context;
    const service = services.importSafety;
    assert(service, "Missing services.importSafety fixture adapter");
    const ids = fixture.sourceIds;
    assert(
      Array.isArray(ids) && ids.length > 0,
      "No selected native-only histories",
    );
    assert.equal(
      new Set(ids).size,
      ids.length,
      "Duplicate selected source IDs",
    );
    const nativeIds = fixture.nativeThreadIds;
    assert(
      nativeIds &&
        ids.every((id) => typeof nativeIds[id] === "string" && nativeIds[id]),
      "Original native thread IDs required for absence proof",
    );
    const checks = [];
    const limitations = [];
    const capture = async (name) => {
      const native = copy(await service.snapshotSource());
      const destination = copy(await service.snapshotDestination());
      validateSnapshot(native, destination, ids);
      const snapshot = { native, destination };
      await writeArtifact(`${name}.json`, snapshot);
      return snapshot;
    };
    const check = (name, detail, evidence) =>
      checks.push({ name, status: "passed", detail, evidence });
    const before = await capture("before-import");

    const counts = { before: summary(before) };
    for (const id of ids)
      assert(
        !before.destination.threads.some(
          (thread) =>
            thread.sourceId === id ||
            thread.id === id ||
            thread.id === nativeIds[id],
        ),
        `Source already connected: ${id}`,
      );
    check(
      "native-only absence",
      `${ids.length} selected histories absent before import`,
      ["before-import.json"],
    );
    const first = copy(await service.import());
    await writeArtifact("initial-import.json", first);
    outcomes(first, ids, "imported");
    const initial = await capture("after-initial");
    assert.deepEqual(
      initial.native,
      before.native,
      "Initial import mutated native source",
    );
    assert.equal(
      initial.destination.threads.length,
      before.destination.threads.length + ids.length,
      "Initial import created unexpected thread count",
    );
    for (const old of before.destination.threads)
      assert.deepEqual(
        initial.destination.threads.find((thread) => thread.id === old.id),
        old,
        "Initial import changed unrelated destination",
      );
    for (const id of ids) {
      const result = first.results.find((item) => item.sourceId === id);
      const matches = initial.destination.threads.filter(
        (thread) => thread.sourceId === id,
      );
      assert.equal(matches.length, 1, `Expected one destination for ${id}`);
      assert.equal(
        matches[0].id,
        result.destinationId,
        "Wrong imported destination identity",
      );
      assert(
        matches[0].messages.length && matches[0].events.length,
        `Empty imported history: ${id}`,
      );
    }
    check(
      "initial source safety",
      "Full native records unchanged; one nonempty destination per selected source",
      ["before-import.json", "initial-import.json", "after-initial.json"],
    );
    const repeat = async (baseline, label) => {
      const result = copy(await service.import());
      await writeArtifact(`${label}-import.json`, result);
      outcomes(result, ids, "skipped");
      assert.equal(
        result.pathIdentity,
        first.pathIdentity,
        "Import path changed between executions",
      );
      for (const id of ids)
        assert.equal(
          result.results.find((item) => item.sourceId === id).destinationId,
          first.results.find((item) => item.sourceId === id).destinationId,
          "Repeat changed destination identity",
        );
      const after = await capture(`after-${label}`);
      counts[label] = summary(after);
      assert.deepEqual(
        after.native,
        baseline.native,
        `${label}: import mutated native logical records`,
      );
      assert.deepEqual(
        after.destination,
        baseline.destination,
        `${label}: import duplicated, erased, or rewound destination records`,
      );
      check(
        label,
        "Zero new threads; exact messages/events/state and full native logical equality",
        [`${label}-import.json`, `after-${label}.json`],
      );
    };
    counts.initial = summary(initial);
    await repeat(initial, "repeat");
    if (service.continueImported) {
      const expectedContinued = fixture.continuationSourceIds;
      assert(
        Array.isArray(expectedContinued) &&
          expectedContinued.length &&
          expectedContinued.every((id) => ids.includes(id)),
        "Declare selected rich continuation source IDs",
      );
      await service.continueImported();
      const continued = await capture("after-continuation");
      assert.deepEqual(
        continued.destination.threads.map((thread) => thread.id),
        initial.destination.threads.map((thread) => thread.id),
        "Continuation changed thread identities",
      );
      const changed = new Set();
      for (const old of initial.destination.threads) {
        const current = continued.destination.threads.find(
          (thread) => thread.id === old.id,
        );
        assert.equal(
          current.sourceId,
          old.sourceId,
          "Continuation changed source mapping",
        );
        assert.deepEqual(
          current.messages.slice(0, old.messages.length),
          old.messages,
          "Continuation lost prior messages",
        );
        assert.deepEqual(
          current.events.slice(0, old.events.length),
          old.events,
          "Continuation lost prior events",
        );
        const added = current.messages.slice(old.messages.length);
        if (
          ids.includes(old.sourceId) &&
          added.some((message) => message.role === "user") &&
          added.some((message) => message.role === "assistant")
        ) {
          assert.notDeepEqual(
            continued.native.find((item) => item.sourceId === old.sourceId),
            initial.native.find((item) => item.sourceId === old.sourceId),
            "Continuation did not reach original native source",
          );
          changed.add(old.sourceId);
        }
      }
      assert(
        expectedContinued.every((id) => changed.has(id)),
        "No imported conversation continued with user and assistant messages",
      );
      // Intentional continuation is the new baseline, never an import mutation.
      await repeat(continued, "post-continuation-repeat");
    } else
      limitations.push(
        "Post-continuation repeat not exercised: no continuation adapter",
      );
    const coverage = fixture.importSafetyCoverage ?? [];
    unique(coverage, "category", "coverage");
    for (const category of categories) {
      const item = coverage.find((entry) => entry.category === category);
      if (item)
        assert(
          statuses.includes(item.status),
          `Unknown coverage status: ${item.status}`,
        );
      const complete =
        item &&
        ["passed", "not-applicable"].includes(item.status) &&
        item.evidence?.length &&
        item.detail;
      if (!complete)
        limitations.push(`${category}: applicable coverage not established`);
      checks.push({
        name: `coverage: ${category}`,
        status: complete
          ? item.status
          : ["failed", "blocked"].includes(item?.status)
            ? item.status
            : "unvalidated",
        evidence: item?.evidence ?? [],
        detail: item?.detail ?? "Missing source coverage evidence",
      });
    }
    if (!service.continueImported)
      checks.push({
        name: "post-continuation repeat",
        status: "unvalidated",
        evidence: [],
        detail: "No real continuation adapter supplied",
      });
    await writeArtifact("counts.json", counts);
    await writeArtifact("coverage.json", {
      coverage,
      provenance: fixture.provenance,
      baseline: context.baseline,
    });
    return {
      status: aggregate(checks),
      checks,
      limitations,
    };
  },
};
