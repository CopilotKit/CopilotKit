import assert from "node:assert/strict";
import {
  validateSource as validateNativeSource,
  assertImported,
} from "../import/assertions.mjs";

import { categories } from "../contract.mjs";

// Run-error persistence is a row1 case; row4 requires successful continuation.
export const continuationCategories = categories.filter(
  (c) => c !== "run-error",
);

/** Fixture services classify observed infrastructure/model failures explicitly. */
export class ContinuationUnavailable extends Error {
  constructor(category, message) {
    super(message);
    assert.ok(["setup", "model", "source"].includes(category));
    this.category = category;
  }
}
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const copy = (value) => structuredClone(value);
const same = (a, b, label) => assert.deepEqual(a, b, label);

/** Reuse row3 source checks before continuing; expected data comes from native inspection. */
export function fromImportedSource(source, native, imported, plan) {
  validateNativeSource(source, native);
  assertImported(source, imported);
  const pending = source.expected.pending[0];
  return {
    ...plan,
    id: source.id,
    provenance: source.provenance.description,
    categories: source.coverage,
    nativeState: native.state,
    nativeItems: native.items,
    mapping: {
      intelligenceId: imported.threadId,
      nativeId: source.nativeIdentity.threadId,
      userId: source.nativeIdentity.userId ?? null,
      appId: source.nativeIdentity.appId ?? null,
      agentId: imported.agentId ?? source.nativeIdentity.agentId,
      nativeAgentId: source.nativeIdentity.agentId,
      resourceId: source.nativeIdentity.resourceId ?? null,
    },
    pending: pending && {
      ...pending,
      checkpointId: pending.checkpoint.id,
      metadata: pending.checkpoint,
    },
  };
}

export function validateSource(source) {
  assert.ok(nonempty(source.id), "Source ID is required");
  assert.ok(nonempty(source.provenance), "Source provenance is required");
  assert.equal(source.absentBeforeImport, true, "Source was already connected");
  assert.ok(
    nonempty(source.importEvidence),
    "Built importer evidence is required",
  );
  assert.ok(
    nonempty(source.nativeValidationEvidence),
    "Native validation evidence is required",
  );
  assert.ok(
    Array.isArray(source.categories) && source.categories.includes("user-text"),
  );
  assert.ok(
    source.categories.some(
      (c) => !["user-text", "assistant-text", "reasoning"].includes(c),
    ),
    "Text-only history cannot establish rich continuation",
  );
  assert.ok(
    ["followup", "frontend-pending", "native-pending"].includes(source.mode),
  );
  assert.ok(
    source.nativeItems.some((item) => item.kind !== "text"),
    "Rich source requires actual non-text occurrences",
  );
  const calls = new Map();
  for (const item of source.nativeItems) {
    assert.ok(nonempty(item.id), "Native item ID is required");
    if (item.kind === "call") {
      assert.ok(!calls.has(item.id), "Duplicate native call ID");
      assert.ok(nonempty(item.id) && nonempty(item.payload?.name));
      assert.ok(Object.hasOwn(item.payload, "arguments"));
      calls.set(item.id, false);
    } else if (item.kind === "result") {
      assert.equal(
        calls.get(item.callId),
        false,
        "Orphaned, reordered or duplicate native result",
      );
      calls.set(item.callId, true);
    }
  }
  const unresolved = [...calls]
    .filter(([, complete]) => !complete)
    .map(([id]) => id);
  if (source.mode === "followup") {
    same(unresolved, [], "Malformed source: unmatched tool call");
  } else {
    assert.ok(nonempty(source.pending?.id));
    assert.ok(nonempty(source.pending?.callId));
    assert.ok(
      nonempty(source.pending?.checkpointId),
      "Pending checkpoint identity required",
    );
    assert.ok(
      source.pending.metadata && Object.keys(source.pending.metadata).length,
      "Full pending metadata required",
    );
    assert.ok(
      unresolved.includes(source.pending.callId),
      "Pending call absent from native source",
    );
    same(
      unresolved,
      [source.pending.callId],
      "Unexpected unmatched source call",
    );
  }
  return source;
}

function validateSnapshot(snapshot, mapping, label) {
  same(snapshot.mapping, mapping, `${label}: original mapping changed`);
  for (const key of [
    "intelligenceId",
    "nativeId",
    "userId",
    "appId",
    "agentId",
    "resourceId",
  ]) {
    assert.ok(
      Object.hasOwn(mapping, key),
      `Missing mapping field ${key}; use null only when not applicable`,
    );
  }
  assert.ok(nonempty(mapping.intelligenceId) && nonempty(mapping.nativeId));
  assert.ok(Array.isArray(snapshot.nativeSessionIds));
  assert.ok(snapshot.nativeSessionIds.includes(mapping.nativeId));
  for (const store of ["native", "intelligence"]) {
    assert.ok(
      nonempty(snapshot[store]?.evidence),
      `${label}: ${store} durable evidence required`,
    );
    assert.equal(snapshot[store].durable, true);
    assert.ok(
      Array.isArray(snapshot[store].items) && snapshot[store].items.length > 0,
    );
    assert.ok(Array.isArray(snapshot[store].pending));
    assert.ok(Object.hasOwn(snapshot[store], "state"));
    const ids = snapshot[store].items.map((item) => item.id);
    assert.ok(ids.every(nonempty));
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${label}: duplicate ${store} item IDs`,
    );
  }
}

/** Historical state is retained except exact paths explicitly changed by this turn. */
function retainedState(before, after, changed, path = []) {
  if (changed.some((p) => JSON.stringify(p) === JSON.stringify(path))) return;
  if (before && typeof before === "object" && !Array.isArray(before)) {
    assert.ok(
      after && typeof after === "object",
      `Lost state at ${path.join(".")}`,
    );
    for (const key of Object.keys(before))
      retainedState(before[key], after[key], changed, [...path, key]);
  } else same(after, before, `Lost prior state at ${path.join(".")}`);
}

export function verifyContinuation({ source, before, after, action }) {
  validateSource(source);
  validateSnapshot(before, source.mapping, "before");
  validateSnapshot(after, source.mapping, "after");
  const added = after.nativeSessionIds.filter(
    (id) => !before.nativeSessionIds.includes(id),
  );
  const auxiliary = after.auxiliarySessions ?? [];
  for (const session of auxiliary) {
    assert.equal(
      session.purpose,
      "title-generation",
      "Unexpected auxiliary conversation",
    );
    assert.equal(
      session.parentNativeId,
      source.mapping.nativeId,
      "Title traffic belongs to another thread",
    );
    assert.ok(
      nonempty(session.evidence),
      "Retain native title-generation provenance",
    );
    assert.ok(
      Array.isArray(session.items) && session.items.length > 0,
      "New empty native session cannot be title traffic",
    );
  }
  same(
    added.toSorted(),
    auxiliary.map((session) => session.id).toSorted(),
    "Continuation created an unexplained native session",
  );
  same(
    after.nativeSessionIds.filter((id) => !added.includes(id)).toSorted(),
    before.nativeSessionIds.toSorted(),
    "Continuation removed an original native session",
  );
  same(
    before.native.items,
    source.nativeItems,
    "Imported source changed before continuation",
  );
  assert.ok(
    Object.hasOwn(source, "nativeState"),
    "Retain original native source state",
  );
  same(
    before.native.state,
    source.nativeState,
    "Original native state changed before continuation",
  );
  same(
    before.intelligence.items,
    source.nativeItems,
    "Intelligence did not retain the imported rich source",
  );
  same(
    before.intelligence.state,
    before.native.state,
    "Imported state differs between stores",
  );
  assert.ok(
    nonempty(action.browserEvidence),
    "Visible imported-thread action evidence required",
  );
  same(
    action.mapping,
    source.mapping,
    "Browser continued a different imported thread",
  );
  assert.ok(nonempty(action.runId));
  assert.ok(Array.isArray(action.events) && action.events.length);
  assert.ok(
    !action.events.some((e) => e.type === "RUN_ERROR"),
    "Continuation emitted RUN_ERROR",
  );
  assert.ok(
    action.events.some(
      (e) => e.type === "RUN_FINISHED" && e.runId === action.runId,
    ),
    "Missing successful terminal event",
  );
  assert.ok(Array.isArray(action.newItems) && action.newItems.length);
  const assistant = action.newItems.filter(
    (i) => i.kind === "text" && i.role === "assistant",
  );
  assert.ok(
    assistant.some((i) => nonempty(i.payload)),
    "No final assistant response",
  );
  if (source.mode === "followup") {
    assert.ok(
      action.newItems.some(
        (i) =>
          i.kind === "text" && i.role === "user" && i.payload === source.prompt,
      ),
    );
    assert.ok(nonempty(source.prompt));
    assert.ok(
      Array.isArray(source.historyTokens) && source.historyTokens.length,
      "History-dependent answer requirements missing",
    );
    for (const token of source.historyTokens) {
      assert.ok(
        nonempty(token) && !source.prompt.includes(token),
        "Follow-up gives away the history answer",
      );
      assert.ok(
        JSON.stringify({
          items: source.nativeItems,
          state: before.native.state,
        }).includes(token),
        "Answer token absent from imported history/state",
      );
      assert.ok(
        assistant.some((i) => i.payload?.includes(token)),
        `Assistant did not recover history token ${token}`,
      );
    }
  } else {
    same(
      action.resumedId,
      source.pending.id,
      "Wrong original pending interaction resumed",
    );
    same(
      action.checkpointId,
      source.pending.checkpointId,
      "Wrong native checkpoint resumed",
    );
    const results = action.newItems.filter(
      (i) => i.kind === "result" && i.callId === source.pending.callId,
    );
    assert.equal(
      results.length,
      1,
      "Missing or duplicate resumed result on original call",
    );
    assert.ok(
      Object.hasOwn(source.pending, "result"),
      "Expected pending result required",
    );
    same(
      results[0].payload,
      source.pending.result,
      "Resumed result differs from expected answer",
    );
    same(
      action.answer,
      source.pending.answer,
      "Wrong pending answer submitted",
    );
  }
  validateSource({
    ...source,
    mode: "followup",
    nativeItems: [...source.nativeItems, ...action.newItems],
  });
  const changed = source.stateChanges ?? [];
  if (changed.length) {
    assert.ok(
      Object.hasOwn(source, "expectedState"),
      "Changed state needs an independently specified expected outcome",
    );
    same(
      action.state,
      source.expectedState,
      "State change differs from the requested outcome",
    );
  }
  assert.ok(
    changed.every((p) => Array.isArray(p) && p.length && p.every(nonempty)),
    "State changes require explicit non-root paths",
  );
  for (const store of ["native", "intelligence"]) {
    same(
      after[store].items.slice(0, before[store].items.length),
      before[store].items,
      `${store}: prior rich history changed or was reordered`,
    );
    same(
      after[store].items.slice(before[store].items.length),
      action.newItems,
      `${store}: new user/assistant/tools payloads differ from emitted items`,
    );
    retainedState(before[store].state, after[store].state, changed);
    same(
      after[store].state,
      action.state,
      `${store}: state differs from emitted final state`,
    );
    for (const path of changed) {
      const value = (obj) => path.reduce((v, key) => v?.[key], obj);
      assert.notDeepEqual(
        value(before[store].state),
        value(after[store].state),
        "Expected state change did not occur",
      );
    }
    if (source.mode !== "followup") {
      assert.ok(
        before[store].pending.some(
          (p) =>
            p.id === source.pending.id && p.callId === source.pending.callId,
        ),
        `${store}: original pending identity absent`,
      );
      assert.ok(
        !after[store].pending.some(
          (p) =>
            p.id === source.pending.id || p.callId === source.pending.callId,
        ),
        `${store}: completed interaction remains pending`,
      );
    }
  }
  return {
    sourceId: source.id,
    mode: source.mode,
    categories: source.categories,
  };
}

export const row = {
  id: 4,
  title: "Continue imported rich threads",
  async run(context) {
    const { fixture, services, writeArtifact } = context;
    const api = services?.continuation;
    if (!api)
      return {
        status: "blocked",
        checks: [
          {
            name: "continuation-bootstrap",
            status: "blocked",
            evidence: [],
            detail: "No continuation fixture/service supplied",
          },
        ],
        limitations: ["No continuation fixture/service supplied"],
      };
    const checks = [];
    const limitations = [];
    const exercised = new Set();
    const modes = new Set();
    let stateUpdated = false;
    let resultSaved = false;
    const sources = await api.sources();
    assert.ok(Array.isArray(sources), "Continuation sources must be an array");
    assert.equal(
      new Set(sources.map((s) => s.id)).size,
      sources.length,
      "Duplicate continuation source IDs",
    );
    for (let index = 0; index < sources.length; index++) {
      const source = copy(sources[index]);
      const artifact = `source-${index}.json`;
      await writeArtifact(artifact, source);
      try {
        validateSource(source);
      } catch (error) {
        checks.push({
          name: `${source.id}:source`,
          status: "unvalidated",
          evidence: [artifact],
          detail: `Malformed/native-source limitation: ${error.message}; retry with a valid rich source`,
        });
        continue;
      }
      const evidence = [artifact];
      try {
        const before = copy(await api.read(source));
        await writeArtifact(`before-${index}.json`, before);
        evidence.push(`before-${index}.json`);
        await api.open(source);
        const action = copy(
          await (source.mode === "followup"
            ? api.followup(source)
            : api.resume(source)),
        );
        await writeArtifact(`action-${index}.json`, action);
        evidence.push(`action-${index}.json`);
        const after = copy(await api.read(source));
        await writeArtifact(`after-${index}.json`, after);
        evidence.push(`after-${index}.json`);
        verifyContinuation({ source, before, after, action });
        source.categories.forEach((c) => exercised.add(c));
        modes.add(source.mode);
        stateUpdated ||= Boolean(source.stateChanges?.length);
        resultSaved ||= action.newItems.some((item) => item.kind === "result");
        checks.push({
          name: source.id,
          status: "passed",
          evidence,
          detail:
            "Original identities, retained rich history/state and new activity verified in both durable stores",
        });
      } catch (error) {
        const category =
          error instanceof ContinuationUnavailable
            ? error.category
            : "continuation";
        const status =
          category === "setup"
            ? "blocked"
            : ["model", "source"].includes(category)
              ? "unvalidated"
              : "failed";
        const errorArtifact = `error-${index}.json`;
        await writeArtifact(errorArtifact, {
          category,
          message: error.message,
        });
        evidence.push(errorArtifact);
        checks.push({
          name: source.id,
          status,
          evidence,
          detail: `${category}: ${error.message}`,
        });
      }
    }
    for (const category of continuationCategories) {
      const coverage = fixture.continuationCoverage?.find(
        (c) => c.category === category,
      );
      if (
        coverage?.status === "not-applicable" &&
        nonempty(coverage.detail) &&
        coverage.evidence?.length
      ) {
        checks.push({
          name: category,
          status: "not-applicable",
          detail: coverage.detail,
          evidence: coverage.evidence,
        });
      } else if (!exercised.has(category))
        limitations.push(`Unvalidated applicable category: ${category}`);
    }
    for (const mode of ["followup", "frontend-pending", "native-pending"]) {
      const category = mode === "followup" ? "user-text" : mode;
      if (
        !modes.has(mode) &&
        !checks.some(
          (c) => c.name === category && c.status === "not-applicable",
        )
      )
        limitations.push(`Missing successful ${mode} source`);
    }
    if (!modes.size)
      limitations.push("No valid rich source continued successfully");
    if (!stateUpdated)
      limitations.push("No requested state update verified in both stores");
    if (!resultSaved)
      limitations.push("No new tool result verified in both stores");
    for (const [index, detail] of limitations.entries())
      checks.push({
        name: `coverage-${index}`,
        status: "unvalidated",
        evidence: [],
        detail,
      });
    return {
      status: checks.some((c) => c.status === "failed")
        ? "failed"
        : checks.some((c) => c.status === "blocked")
          ? "blocked"
          : limitations.length || checks.some((c) => c.status === "unvalidated")
            ? "unvalidated"
            : "passed",
      checks,
      limitations,
    };
  },
};
