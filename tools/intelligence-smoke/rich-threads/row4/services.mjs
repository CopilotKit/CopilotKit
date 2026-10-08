import assert from "node:assert/strict";
import { continuationPlan } from "./scenarios.mjs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { artifactWriter } from "../contract.mjs";
import { fromImportedSource, ContinuationUnavailable } from "../rows/row4.mjs";
import {
  occurrences,
  messageOccurrences,
  nativeSessions,
  observedMapping,
  newRuns,
  observedResume,
} from "./observations.mjs";

/** Concrete row4 composition: row3 owns actual native creation/CLI import and
 * independent readers; common owns the real Showcase browser and raw capture.
 * This factory never provisions services or substitutes an in-memory fixture.
 */
export async function createServices(context) {
  const { scope, outputDir } = context;
  assert.ok(
    scope.owner && scope.native?.location,
    "Owned environment/native store required",
  );
  const { createServices: createImportServices } =
    await import("../import/services.mjs");
  const prepared = await createImportServices({
    ...context,
    outputDir: join(outputDir, "row4-import"),
  });
  return createContinuationServices({
    ...context,
    importReplay: prepared.services.importReplay,
  });
}

export function createContinuationServices({
  framework,
  scope,
  browser,
  capture,
  importReplay,
  outputDir,
  signal,
}) {
  const write = artifactWriter(join(outputDir, "row4-driver"));
  const records = new Map();
  let serial = 0;
  async function save(label, value) {
    return `row4-driver/${await write(`${serial++}-${label}.json`, value)}`;
  }
  async function read(source) {
    signal?.throwIfAborted();
    const record = records.get(source.id);
    assert.ok(record, "Continuation source was not prepared in this run");
    const [native, imported, ids] = await Promise.all([
      importReplay.inspectNative(record.source),
      importReplay.readImported(record.source, record.imported),
      nativeSessions(framework, scope.native),
    ]);
    const evidence = await save("stores", {
      native,
      imported,
      nativeSessionIds: ids,
    });
    assert.ok(native.rawCheckpoint, "Independent native checkpoint missing");
    const mapping = observedMapping(imported);
    assert.deepEqual(
      native.identity,
      imported.nativeIdentity,
      "Durable native/user/resource identity mismatch",
    );
    assert.equal(
      native.identity.threadId,
      mapping.nativeId,
      "Native reader returned wrong thread",
    );
    assert.equal(
      native.identity.agentId,
      mapping.nativeAgentId,
      "Native reader returned wrong agent",
    );
    const snapshot = {
      mapping,
      nativeSessionIds: ids,
      native: {
        ...native,
        items: occurrences(native.items),
        durable: true,
        evidence,
      },
      intelligence: {
        ...imported,
        items: occurrences(imported.items),
        durable: true,
        evidence,
      },
    };
    record.lastSnapshot = structuredClone(snapshot);
    return snapshot;
  }
  async function act(source) {
    const record = records.get(source.id);
    assert.ok(
      record?.thread && record.captureBefore,
      "Open the actual imported thread before acting",
    );
    const beforeNative = structuredClone(record.lastSnapshot.native);
    let receipt;
    if (source.mode === "followup")
      receipt = await browser.send(record.thread, source.prompt);
    else {
      assert.ok(
        source.pending.action,
        "Source must declare its actual Showcase control action",
      );
      receipt = await browser.interact(record.thread, source.pending.action);
    }
    await save("browser-action", receipt);
    // Wait only for observed terminal capture. RUN_ERROR is preserved and fails
    // assertions rather than being retried as a model/setup success.
    const deadline = Date.now() + 120_000;
    let captured;
    let runs;
    let terminal = false;
    while (!terminal) {
      signal?.throwIfAborted();
      captured = await capture.read(source.mapping.intelligenceId);
      await save("capture-poll", captured);
      if (
        captured.runs?.some(
          (run) =>
            !record.captureBefore.runs.some(
              (old) => old.input.runId === run.input.runId,
            ),
        )
      ) {
        runs = newRuns(record.captureBefore, captured);
        terminal = runs.every((run) =>
          run.events.some((event) =>
            ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
          ),
        );
        if (terminal) break;
      }
      if (Date.now() >= deadline)
        throw new ContinuationUnavailable(
          "setup",
          "Timed out retaining terminal framework capture after browser action",
        );
      await delay(500, undefined, { signal });
    }
    const visible = await browser.snapshot(record.thread);
    const browserEvidence = await save("browser-after", visible);
    assert.equal(
      visible.threadId,
      source.mapping.intelligenceId,
      "Browser selected a different imported thread",
    );
    assert.ok(
      visible.screenshot || visible.screenshots?.length,
      "Actual browser screenshot is required",
    );
    for (const run of runs)
      assert.equal(
        run.input.threadId,
        source.mapping.nativeId,
        "Framework received a replacement native thread",
      );
    const last = runs.at(-1);
    assert.ok(
      Array.isArray(last.messages),
      "Final messages must come from input/framework events capture",
    );
    assert.ok(
      Object.hasOwn(last, "state"),
      "Final state must come from framework capture",
    );
    const emitted = messageOccurrences(last.messages, last.resolvedMedia);
    const historical = occurrences(source.nativeItems);
    assert.deepEqual(
      emitted.slice(0, historical.length),
      historical,
      "Framework capture did not retain original rich history",
    );
    const action = {
      mapping: {
        ...observedMapping(
          await importReplay.readImported(record.source, record.imported),
        ),
        intelligenceId: visible.threadId,
        nativeId: last.input.threadId,
      },
      runId: last.input.runId,
      events: runs.flatMap((run) => run.events),
      newItems: emitted.slice(historical.length),
      state: last.state,
      browserEvidence,
    };
    if (source.mode !== "followup")
      Object.assign(action, observedResume(beforeNative, runs));
    await save("observed-action", action);
    return action;
  }
  return {
    fixture: {},
    services: {
      continuation: {
        async sources() {
          const entries = await importReplay.prepareImportedSources({
            answerPending: false,
            namespace: "row4",
          });
          assert.ok(entries.length, "No rich native sources were prepared");
          const sources = [];
          for (const entry of entries) {
            const plan = continuationPlan(entry);
            const source = fromImportedSource(
              entry.source,
              entry.native,
              entry.imported,
              plan,
            );
            source.nativeItems = occurrences(source.nativeItems);
            if (source.pending)
              source.pending = {
                ...source.pending,
                answer: plan.pending?.answer ?? source.pending.answer,
                result: plan.pending?.result ?? source.pending.result,
                action: plan.pending?.action,
              };
            assert.ok(
              !records.has(source.id),
              "Duplicate row4 source identity",
            );
            records.set(source.id, entry);
            await save("imported-source", entry);
            sources.push(source);
          }
          return sources;
        },
        read,
        async open(source) {
          const record = records.get(source.id);
          assert.ok(
            record?.lastSnapshot,
            "Read independent stores before opening the imported thread",
          );
          const before = await capture.read(source.mapping.intelligenceId);
          assert.ok(
            Array.isArray(before.runs),
            "Capture must include actual framework-bound runs",
          );
          record.thread = await browser.openThread(
            source.mapping.intelligenceId,
          );
          const visible = await browser.snapshot(record.thread);
          await save("browser-open", visible);
          assert.equal(
            visible.threadId,
            source.mapping.intelligenceId,
            "Browser did not open imported destination",
          );
          record.captureBefore = await capture.read(
            source.mapping.intelligenceId,
          );
          assert.deepEqual(
            record.captureBefore.runs.map((run) => run.input.runId),
            before.runs.map((run) => run.input.runId),
            "Opening imported history reran the agent",
          );
        },
        followup: act,
        resume: act,
      },
    },
  };
}
