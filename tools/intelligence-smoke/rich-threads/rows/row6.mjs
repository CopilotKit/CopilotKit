import assert from "node:assert/strict";

// No framework-specific normalization: fixture adapters must return the complete
// durable logical record, including native sidecars and pending metadata.
const copy = (value) => structuredClone(value);
const categories = [
  "text",
  "reasoning",
  "pie-chart",
  "bar-chart",
  "image",
  "document",
  "audio",
  "video",
  "flight-cards",
  "a2ui",
  "open-genui",
  "tools",
  "mcp",
  "mcp-app",
  "shared-state",
  "frontend-completed",
  "frontend-pending",
  "native-completed",
  "native-pending",
];

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
    for (const id of ids)
      assert(
        !before.destination.threads.some(
          (thread) => thread.sourceId === id || thread.id === id,
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
    await repeat(initial, "repeat");
    if (service.continueImported) {
      await service.continueImported();
      const continued = await capture("after-continuation");
      assert.deepEqual(
        continued.destination.threads.map((thread) => thread.id),
        initial.destination.threads.map((thread) => thread.id),
        "Continuation changed thread identities",
      );
      let changed = 0;
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
          changed += 1;
        }
      }
      assert(
        changed > 0,
        "No imported conversation continued with user and assistant messages",
      );
      // Intentional continuation is the new baseline, never an import mutation.
      await repeat(continued, "post-continuation-repeat");
    } else
      limitations.push(
        "Post-continuation repeat not exercised: no continuation adapter",
      );
    const coverage = fixture.importSafetyCoverage ?? [];
    for (const category of categories) {
      const item = coverage.find((entry) => entry.category === category);
      if (
        !item ||
        !["passed", "not-applicable"].includes(item.status) ||
        !item.evidence?.length ||
        !item.detail
      )
        limitations.push(`${category}: applicable coverage not established`);
    }
    await writeArtifact("coverage.json", {
      coverage,
      provenance: fixture.provenance,
      baseline: context.baseline,
    });
    return {
      status: limitations.length ? "unvalidated" : "passed",
      checks,
      limitations,
    };
  },
};
