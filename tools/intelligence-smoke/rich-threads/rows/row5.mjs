import assert from "node:assert/strict";

export const requiredItems = [
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
  "mcp-tools",
  "mcp-app",
  "state",
  "parallel-surfaces",
];
const kinds = [
  "rich",
  "frontend-pending",
  "frontend-completed",
  "native-pending",
  "native-completed",
];
const roles = [
  "intelligence-api",
  "intelligence-gateway",
  "application-runtime",
  "native-backend",
];
const stores = ["intelligence", "native"];
const copy = (value) => structuredClone(value);

export function assertSnapshot(snapshot) {
  for (const key of [
    "intelligenceThreadId",
    "nativeThreadId",
    "userId",
    "agentId",
  ])
    assert.ok(
      typeof snapshot.identity?.[key] === "string" && snapshot.identity[key],
      `Missing identity ${key}`,
    );
  for (const store of stores) {
    assert.ok(
      Array.isArray(snapshot[store]?.items) && snapshot[store].items.length,
      `${store}: empty history`,
    );
    assert.ok(
      snapshot[store].state !== undefined,
      `${store}: state was not inspected`,
    );
    assert.ok(
      Array.isArray(snapshot[store].controls),
      `${store}: controls were not inspected`,
    );
    const ids = snapshot[store].controls.map((control) => control.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${store}: duplicate control IDs`,
    );
  }
}

export function assertSurvives(before, after) {
  assertSnapshot(after);
  assert.deepEqual(
    after,
    before,
    "History/state/control identity changed across reload or restart",
  );
}

export function assertRestarts(receipts, owner) {
  assert.ok(
    typeof owner === "string" && owner,
    "Explicit resource owner required",
  );
  assert.ok(Array.isArray(receipts), "Restart receipts required");
  for (const role of roles)
    assert.ok(
      receipts.some((entry) => entry.role === role),
      `Missing actual restart: ${role}`,
    );
  const names = new Set();
  for (const entry of receipts) {
    assert.equal(
      entry.owner,
      owner,
      "Refusing restart evidence from another resource owner",
    );
    assert.ok(
      entry.service && !names.has(entry.service),
      "Duplicate/missing restart service",
    );
    names.add(entry.service);
    assert.ok(
      entry.before?.instance && entry.after?.instance,
      "Missing process/container incarnation",
    );
    assert.notEqual(
      entry.before.instance,
      entry.after.instance,
      `${entry.service}: process did not restart`,
    );
    assert.ok(
      entry.before.store && entry.before.store !== "memory",
      `${entry.service}: durable store required`,
    );
    assert.deepEqual(
      entry.after.store,
      entry.before.store,
      `${entry.service}: changed durable store`,
    );
    assert.equal(
      entry.ready,
      true,
      `${entry.service}: not ready after restart`,
    );
  }
}

function controlIn(snapshot, store, scenario, status) {
  const found = snapshot[store].controls.find(
    (entry) => entry.id === scenario.interactionId,
  );
  assert.ok(
    found,
    `${store}: original interaction missing ${scenario.interactionId}`,
  );
  assert.equal(found.kind, scenario.kind.split("-")[0]);
  assert.equal(found.status, status, `${store}: wrong interaction status`);
  assert.ok(
    found.payload !== undefined,
    `${store}: missing interaction payload`,
  );
  if (status === "completed") {
    assert.ok(found.result !== undefined, `${store}: completed result missing`);
    assert.ok(
      found.finalResponse,
      `${store}: resumed assistant response missing`,
    );
  }
  return found;
}

export function assertContinued(before, after, expected) {
  assertSnapshot(after);
  assert.deepEqual(
    after.identity,
    before.identity,
    "Continuation switched thread/session identity",
  );
  assert.ok(
    expected?.userItem && expected?.assistantItem,
    "Expected follow-up user and assistant items required",
  );
  for (const store of stores) {
    const prior = before[store].items;
    assert.deepEqual(
      after[store].items.slice(0, prior.length),
      prior,
      `${store}: prior rich history changed`,
    );
    const added = after[store].items.slice(prior.length);
    assert.ok(
      added.some(
        (item) => JSON.stringify(item) === JSON.stringify(expected.userItem),
      ),
      `${store}: follow-up user item missing`,
    );
    assert.ok(
      added.some(
        (item) =>
          JSON.stringify(item) === JSON.stringify(expected.assistantItem),
      ),
      `${store}: follow-up assistant item missing`,
    );
    assert.deepEqual(
      after[store].state,
      expected.state,
      `${store}: follow-up state mismatch`,
    );
    assert.deepEqual(
      after[store].controls,
      before[store].controls,
      `${store}: continuation changed completed controls`,
    );
  }
}

export function assertResumed(before, after, scenario) {
  assertSnapshot(after);
  assert.deepEqual(
    after.identity,
    before.identity,
    "Resume switched original identity",
  );
  for (const store of stores) {
    const pending = controlIn(before, store, scenario, "pending");
    const completed = controlIn(after, store, scenario, "completed");
    assert.deepEqual(
      completed.payload,
      pending.payload,
      `${store}: resumed a different payload`,
    );
    assert.deepEqual(
      after[store].items.slice(0, before[store].items.length),
      before[store].items,
      `${store}: resume lost prior history`,
    );
    assert.ok(
      after[store].items.length > before[store].items.length,
      `${store}: resume emitted no saved activity`,
    );
    assert.ok(
      after[store].items.some(
        (item) =>
          JSON.stringify(item) === JSON.stringify(completed.finalResponse),
      ),
      `${store}: final response not in history`,
    );
    for (const previous of before[store].controls.filter(
      (entry) => entry.id !== scenario.interactionId,
    ))
      assert.deepEqual(
        after[store].controls.find((entry) => entry.id === previous.id),
        previous,
        `${store}: unrelated control mutated`,
      );
  }
  assert.deepEqual(
    controlIn(after, "intelligence", scenario, "completed").result,
    controlIn(after, "native", scenario, "completed").result,
    "Resume result differs between stores",
  );
}

async function browserCheck(api, scenario, snapshot, phase, write) {
  const visible = await api.open(scenario, { reload: true, phase });
  await write(`${scenario.id}-${phase}-browser.json`, visible);
  assert.deepEqual(
    visible.identity,
    snapshot.identity,
    "Browser reopened the wrong thread",
  );
  assert.ok(visible.evidence?.length, "Visible browser evidence required");
  // The renderer projection must be declared by the fixture, not derived from the DOM under test.
  const expected = await api.expectedBrowser(scenario, snapshot, phase);
  for (const key of ["items", "state", "controls"]) {
    assert.ok(
      expected[key] !== undefined,
      `Browser expectation missing ${key}`,
    );
    assert.deepEqual(
      visible[key],
      expected[key],
      `Browser ${key} differs after ${phase}`,
    );
  }
}

export const row = {
  id: 5,
  title: "Reload and backend restart durability",
  async run(context) {
    const api = context.services?.row5;
    assert.ok(api, "Row5 lifecycle fixture is required");
    for (const method of [
      "prepare",
      "read",
      "open",
      "expectedBrowser",
      "restart",
      "respond",
      "followup",
    ])
      assert.equal(
        typeof api[method],
        "function",
        `Missing row5 service ${method}`,
      );
    const write = (name, value) => context.writeArtifact(name, copy(value));
    const scenarios = await api.prepare();
    await write("scenarios.json", scenarios);
    const ids = new Set();
    for (const scenario of scenarios) {
      assert.match(scenario.id, /^[a-z0-9-]+$/);
      assert.ok(!ids.has(scenario.id), "Duplicate scenario ID");
      ids.add(scenario.id);
      assert.ok(scenario.provenance, "Fixture provenance required");
    }
    const limitations = [];
    for (const origin of ["fresh", "imported"]) {
      for (const kind of kinds)
        assert.ok(
          scenarios.some(
            (scenario) => scenario.origin === origin && scenario.kind === kind,
          ),
          `Missing ${origin} ${kind} control`,
        );
      for (const item of requiredItems) {
        const coverage = scenarios
          .filter((scenario) => scenario.origin === origin)
          .flatMap((scenario) => scenario.coverage ?? [])
          .filter((entry) => entry.item === item);
        if (
          !coverage.some(
            (entry) => entry.status === "exercised" && entry.evidence?.length,
          )
        ) {
          const excluded = coverage.find(
            (entry) =>
              entry.status === "not-applicable" &&
              entry.evidence?.length &&
              entry.detail,
          );
          if (!excluded) limitations.push(`${origin}: ${item} unvalidated`);
        }
      }
    }
    const before = new Map();
    for (const scenario of scenarios) {
      const snapshot = copy(await api.read(scenario));
      assertSnapshot(snapshot);
      if (scenario.kind !== "rich") {
        assert.ok(scenario.interactionId, "Original control ID required");
        for (const store of stores)
          controlIn(
            snapshot,
            store,
            scenario,
            scenario.kind.endsWith("pending") ? "pending" : "completed",
          );
      }
      before.set(scenario.id, snapshot);
      await write(`${scenario.id}-before.json`, snapshot);
      await browserCheck(
        api,
        scenario,
        snapshot,
        "reload-before-restart",
        write,
      );
      const reloaded = copy(await api.read(scenario));
      await write(`${scenario.id}-reloaded.json`, reloaded);
      assertSurvives(snapshot, reloaded);
    }
    const receipts = await api.restart();
    await write("restarts.json", receipts);
    assertRestarts(receipts, context.fixture.row5.owner);
    const checks = [];
    for (const scenario of scenarios) {
      const restarted = copy(await api.read(scenario));
      await write(`${scenario.id}-restarted.json`, restarted);
      assertSurvives(before.get(scenario.id), restarted);
      await browserCheck(api, scenario, restarted, "after-restart", write);
      let final = restarted;
      if (scenario.kind.endsWith("pending")) {
        await api.respond(scenario, { interactionId: scenario.interactionId });
        final = copy(await api.read(scenario));
        await write(`${scenario.id}-resumed.json`, final);
        assertResumed(restarted, final, scenario);
      } else if (scenario.kind === "rich") {
        const expected = await api.followup(scenario);
        await write(`${scenario.id}-followup-expected.json`, expected);
        final = copy(await api.read(scenario));
        await write(`${scenario.id}-continued.json`, final);
        assertContinued(restarted, final, expected);
      }
      await browserCheck(api, scenario, final, "final-reload", write);
      const finalReload = copy(await api.read(scenario));
      await write(`${scenario.id}-final.json`, finalReload);
      assertSurvives(final, finalReload);
      checks.push({
        name: scenario.id,
        status: "passed",
        evidence: [
          `${scenario.id}-before.json`,
          `${scenario.id}-restarted.json`,
          `${scenario.id}-final.json`,
          "restarts.json",
        ],
        detail:
          "Original identity, both stores and visible replay checked across owned service restart",
      });
    }
    return {
      status: limitations.length ? "unvalidated" : "passed",
      checks,
      limitations,
    };
  },
};
