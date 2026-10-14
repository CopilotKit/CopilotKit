import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { aggregate, requireText } from "../contract.mjs";

/** Exact occurrence comparison. Adapters may unwrap transport envelopes, never drop fields or sort arrays. */
export function comparePersistence(emitted, saved) {
  for (const key of ["threadId", "agentId", "userId"]) {
    requireText(emitted[key], `Emitted ${key}`);
    assert.equal(saved[key], emitted[key], `${key} changed`);
  }
  assert.ok(
    Array.isArray(emitted.runIds) && emitted.runIds.length,
    "No observed runs",
  );
  assert.deepEqual(
    saved.runIds,
    emitted.runIds,
    "Run identities/order changed",
  );
  assert.ok(
    Array.isArray(emitted.events) && emitted.events.length,
    "No emitted events",
  );
  assert.ok(
    Array.isArray(emitted.messages) && emitted.messages.length,
    "No reconstructed messages",
  );
  for (const key of ["events", "messages", "state", "pending"]) {
    assert.ok(Object.hasOwn(emitted, key), `Missing emitted ${key}`);
    assert.deepEqual(
      saved[key],
      emitted[key],
      `Persisted ${key} lost, altered, reordered or misassociated`,
    );
  }
  return {
    events: emitted.events.length,
    messages: emitted.messages.length,
    sha256: createHash("sha256").update(JSON.stringify(emitted)).digest("hex"),
  };
}

/** Require actual successful source behavior; no requested-but-unemitted item passes. */
export function verifyJourney(emitted) {
  assert.ok(
    !emitted.events.some((event) => event.type === "RUN_ERROR"),
    "Live model run failed",
  );
  assert.ok(
    emitted.runIds.every((id) =>
      emitted.events.some(
        (event) => event.type === "RUN_FINISHED" && event.runId === id,
      ),
    ),
    "Missing successful terminal run",
  );
  assert.ok(
    emitted.messages.some(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.trim(),
    ),
    "User text was not emitted",
  );
  const calls = emitted.messages
    .flatMap((message) => message.toolCalls ?? [])
    .filter((call) => call.name === "query_data");
  assert.ok(calls.length, "query_data was not emitted: scenario coverage gap");
  for (const call of calls) {
    requireText(call.id, "Original query_data call ID");
    const result = emitted.messages.findIndex(
      (message) =>
        message.role === "tool" &&
        message.toolCallId === call.id &&
        message.content,
    );
    assert.ok(result >= 0, "query_data result missing or misassociated");
    assert.ok(
      emitted.messages
        .slice(result + 1)
        .some(
          (message) =>
            message.role === "assistant" &&
            typeof message.content === "string" &&
            message.content.trim(),
        ),
      "Assistant reply after query_data result missing",
    );
  }
  return { toolCallIds: calls.map((call) => call.id) };
}

async function browserProof(browser, outputDir) {
  assert.ok(
    browser?.fresh === true,
    "Scenario did not start through a fresh browser conversation",
  );
  requireText(browser.url, "Browser URL");
  assert.ok(
    Array.isArray(browser.screenshots) && browser.screenshots.length,
    "Visible UI screenshot required",
  );
  for (const name of browser.screenshots) {
    const path = relative(resolve(outputDir), resolve(outputDir, name));
    assert.ok(
      path && !path.startsWith("..") && !isAbsolute(path),
      "Screenshot outside owned output",
    );
    await access(resolve(outputDir, path));
  }
}

export const row = {
  id: 1,
  title: "Bounded row1: fresh text/query_data conversation → Intelligence",
  async run({ fixture, services, writeArtifact, outputDir }) {
    const checks = [];
    assert.equal(
      fixture.row1?.scenarios?.length,
      1,
      "One declared bounded scenario required",
    );
    for (const scenario of fixture.row1.scenarios) {
      assert.equal(scenario.id, "text-query-data");
      const evidence = [];
      let layer = "environment";
      try {
        const live = structuredClone(await services.row1.runFresh(scenario));
        evidence.push(await writeArtifact(`${scenario.id}/emitted.json`, live));
        const saved = await services.row1.readSaved(
          structuredClone(live.emitted),
        );
        evidence.push(await writeArtifact(`${scenario.id}/saved.json`, saved));
        layer = "intelligence-persistence";
        const proof = comparePersistence(live.emitted, saved);
        layer = "generation-coverage";
        const journey = verifyJourney(live.emitted);
        layer = "rendering";
        await browserProof(live.browser, outputDir);
        requireText(live.browser.assistantText, "Visible assistant response");
        const assistant = live.emitted.messages.findLast(
          (message) =>
            message.role === "assistant" &&
            typeof message.content === "string" &&
            message.content.trim(),
        );
        assert.ok(
          live.browser.assistantText
            .replace(/\s+/g, " ")
            .includes(assistant.content.replace(/\s+/g, " ")),
          "Browser did not display the emitted assistant reply",
        );
        evidence.push(
          await writeArtifact(`${scenario.id}/proof.json`, {
            ...proof,
            ...journey,
          }),
        );
        checks.push({
          name: scenario.id,
          status: "passed",
          evidence,
          detail:
            "Declared text/tool journey compared exactly; broader row1 coverage is deferred",
        });
      } catch (error) {
        evidence.push(...(error.evidence ?? []));
        checks.push({
          name: scenario.id,
          status: layer === "environment" ? "blocked" : "failed",
          layer,
          evidence,
          detail: String(error),
        });
      }
    }
    return {
      status: aggregate(checks),
      checks,
      limitations: [
        "Only row1-text-query-data-v1; expanded row1 and rows2–6 are deferred, not validated",
      ],
    };
  },
};
