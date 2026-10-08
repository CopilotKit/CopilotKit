import assert from "node:assert/strict";

export const categories = [
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
  "calculator",
  "tools",
  "mcp",
  "mcp-app",
  "state",
  "frontend-completed",
  "frontend-pending",
  "native-completed",
  "native-pending",
  "parallel-surfaces",
];

/** These records come from native inspection, never from the importer under test. */
export function validateSource(source, native) {
  assert.match(source.id, /^[a-zA-Z0-9_-]+$/);
  assert.ok(source.provenance.description, "Source provenance is required");
  for (const field of ["nativeOnly", "durable", "completeCheckpoint"])
    assert.equal(source.provenance[field], true, `Source must be ${field}`);
  assert.ok(
    source.nativeIdentity.threadId,
    "Original native thread ID required",
  );
  assert.ok(source.nativeIdentity.agentId, "Original native agent ID required");
  assert.deepEqual(
    native.identity,
    source.nativeIdentity,
    "Native identity differs",
  );
  assert.ok(
    native.rawCheckpoint,
    "Retain the entire native checkpoint/session",
  );
  assert.ok(
    native.items.length,
    "Empty native history is not onboarding coverage",
  );
  assert.deepEqual(
    native.items,
    source.expected.items,
    "Fixture disagrees with native source",
  );
  assert.deepEqual(
    native.state,
    source.expected.state,
    "Fixture state disagrees with source",
  );
  assert.deepEqual(
    native.pending,
    source.expected.pending,
    "Pending checkpoint metadata differs",
  );
  const calls = new Map();
  for (const item of native.items) {
    assert.ok(item.id && item.kind, "Every occurrence needs identity and kind");
    if (item.kind === "call") {
      assert.ok(!calls.has(item.id), `Duplicate native call ${item.id}`);
      calls.set(item.id, false);
    }
    if (item.kind === "result") {
      assert.ok(calls.has(item.callId), `Orphan native result ${item.callId}`);
      assert.equal(
        calls.get(item.callId),
        false,
        `Duplicate result ${item.callId}`,
      );
      calls.set(item.callId, true);
    }
  }
  for (const [id, completed] of calls)
    assert.ok(
      completed || native.pending.some((p) => p.callId === id),
      `Orphan native call ${id}`,
    );
  for (const pending of native.pending) {
    assert.ok(["frontend", "native"].includes(pending.kind));
    assert.ok(
      pending.id && pending.callId && pending.checkpoint,
      "Complete pending metadata required",
    );
    assert.equal(
      calls.get(pending.callId),
      false,
      "Pending control needs an unanswered native call",
    );
  }
}

export function assertImported(source, imported) {
  assert.ok(imported.threadId, "Missing Intelligence identity");
  assert.deepEqual(
    imported.nativeIdentity,
    source.nativeIdentity,
    "Importer changed native mapping",
  );
  assert.deepEqual(
    imported.items,
    source.expected.items,
    "Imported occurrences differ: identity/order/payload",
  );
  assert.deepEqual(
    imported.state,
    source.expected.state,
    "Imported state differs",
  );
  assert.deepEqual(
    imported.pending,
    source.expected.pending,
    "Imported pending controls differ",
  );
}

export function assertReplay(source, imported, replay) {
  assert.equal(
    replay.threadId,
    imported.threadId,
    "Browser opened the wrong thread",
  );
  assert.ok(replay.screenshot && replay.url, "Retain browser evidence");
  assert.deepEqual(
    replay.observations,
    source.replay,
    "Visible rich replay differs",
  );
  assert.deepEqual(
    replay.runRequests,
    [],
    "Historical replay must not rerun tools",
  );
}

export function assertAnswered(source, imported, pending, observed) {
  assert.ok(
    observed.browser.screenshot && observed.browser.action,
    "A visible button is not actionability",
  );
  assert.equal(observed.browser.threadId, imported.threadId);
  assert.equal(observed.browser.controlId, pending.id);
  assert.deepEqual(
    observed.native.identity,
    source.nativeIdentity,
    "Resume changed native session",
  );
  assert.equal(observed.intelligence.threadId, imported.threadId);
  assert.deepEqual(observed.intelligence.nativeIdentity, source.nativeIdentity);
  assert.ok(
    observed.emitted.finalResponse,
    "Resume emitted no final assistant response",
  );
  assert.deepEqual(observed.emitted.answer, pending.answer);
  for (const snapshot of [observed.native, observed.intelligence]) {
    assert.deepEqual(
      snapshot.items.slice(0, source.expected.items.length),
      source.expected.items,
      "Resume lost history",
    );
    assert.ok(
      !snapshot.pending.some(
        (p) => p.id === pending.id || p.callId === pending.callId,
      ),
      "Pending control not cleared",
    );
    const results = snapshot.items.filter(
      (item) => item.kind === "result" && item.callId === pending.callId,
    );
    assert.equal(
      results.length,
      1,
      "Resume must save exactly one matching result",
    );
    assert.deepEqual(results[0].payload, pending.result);
    assert.ok(
      snapshot.items.some(
        (item) =>
          item.kind === "text" &&
          item.payload === observed.emitted.finalResponse,
      ),
      "Final response not saved",
    );
  }
}
