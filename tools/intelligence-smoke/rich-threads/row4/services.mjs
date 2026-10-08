import assert from "node:assert/strict";
import { continuationPlan } from "./scenarios.mjs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { artifactWriter } from "../contract.mjs";
import { fromImportedSource } from "../rows/row4.mjs";
import {
  occurrences,
  messageOccurrences,
  nativeSessions,
  observedMapping,
  newRuns,
  observedResume,
  newActivity,
} from "./observations.mjs";

/** Concrete row4 composition: row3 owns actual native creation/CLI import and
 * independent readers; common owns the real Showcase browser and raw capture.
 * This factory never provisions services or substitutes an in-memory fixture.
 */
export async function createServices(context) {
  const { scope, outputDir, environment } = context;
  assert.ok(
    scope.owner && scope.native?.location,
    "Owned environment/native store required",
  );
  assert.equal(
    environment.receipt?.cleanScope?.status,
    "passed",
    "Verified clean-scope receipt required before import",
  );
  const { createServices: createImportServices } =
    await import("../import/services.mjs");
  const prepared = await createImportServices({
    ...context,
    outputDir: join(outputDir, "row4-import"),
  });
  const { projectEvents } = await import("../capture/project.mjs");
  return createContinuationServices({
    ...context,
    capture: {
      ...context.capture,
      project: (events) => projectEvents({ events, ...context.dependencies }),
    },
    importReplay: prepared.services.importReplay,
  });
}

export function createContinuationServices({
  framework,
  scope,
  browser,
  capture,
  importReplay,
  intelligence,
  outputDir,
  signal,
}) {
  const write = artifactWriter(join(outputDir, "row4-driver"));
  const records = new Map();
  let serial = 0;
  async function save(label, value) {
    return `row4-driver/${await write(`${serial++}-${label}.json`, value)}`;
  }
  async function readCapture(source) {
    const [canonical, native] = await Promise.all([
      capture.read(source.mapping.intelligenceId),
      capture.read(source.mapping.nativeId),
    ]);
    return { events: canonical.events, frameworkRuns: native.frameworkRuns };
  }
  async function read(source) {
    signal?.throwIfAborted();
    const record = records.get(source.id);
    assert.ok(record, "Continuation source was not prepared in this run");
    if (record.actionEvents) {
      const deadline = Date.now() + 30_000;
      let persisted = false;
      while (!persisted && Date.now() < deadline) {
        signal?.throwIfAborted();
        const saved = await intelligence.read(source.mapping.intelligenceId);
        await save("durability-poll", saved);
        const ids = new Set(
          saved.events.map((event) => event.metadata?.cpki_event_id),
        );
        persisted = record.actionEvents.every((event) =>
          ids.has(event.metadata.cpki_event_id),
        );
        if (!persisted) await delay(250, undefined, { signal });
      }
      assert.ok(
        persisted,
        "Continuation events did not become durable within 30s",
      );
    }
    const [native, imported, ids] = await Promise.all([
      importReplay.inspectNative(record.source),
      importReplay.readImported(record.source, record.imported),
      nativeSessions(framework, {
        ...scope.native,
        location: record.native.rawCheckpoint.location ?? scope.native.location,
      }),
    ]);
    const evidence = await save("stores", {
      native,
      imported,
      nativeSessionIds: ids,
    });
    assert.ok(native.rawCheckpoint, "Independent native checkpoint missing");
    assert.equal(
      native.rawCheckpoint.location,
      record.native.rawCheckpoint.location,
      "Continuation changed native storage location",
    );
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
      captured = await readCapture(source);
      await save("capture-poll", captured);
      if (
        captured.frameworkRuns?.some(
          (run) =>
            !record.captureBefore.frameworkRuns.some(
              (old) => old.input.runId === run.input.runId,
            ),
        )
      ) {
        runs = newRuns(record.captureBefore, captured);
        for (const run of runs)
          assert.ok(!run.error, `Framework stream failed: ${run.error}`);
        terminal = runs.every(
          (run) =>
            run.complete &&
            run.events.some((event) =>
              ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
            ) &&
            captured.events.some(
              (event) =>
                event.runId === run.input.runId &&
                ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
            ),
        );
        if (terminal) break;
      }
      if (Date.now() >= deadline)
        throw new Error(
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
    const previousEvents = new Set(
      record.captureBefore.events.map((event) => event.metadata?.cpki_event_id),
    );
    const events = captured.events.filter(
      (event) => !previousEvents.has(event.metadata?.cpki_event_id),
    );
    assert.ok(events.length, "No new pre-ingestion canonical events captured");
    assert.ok(
      events.every((event) => event.metadata?.cpki_event_id),
      "Canonical event identity missing",
    );
    record.actionEvents = structuredClone(events);
    const projected = await capture.project(events);
    await save("projected-emission", projected);
    const emitted = messageOccurrences(
      projected.messages,
      projected.resolvedMedia,
    );
    const historical = occurrences(source.nativeItems);
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
      newItems: newActivity(historical, emitted),
      state: projected.state,
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
            const sourceEvidence = await save("imported-source", entry);
            if (entry.source.coverage.includes("native-completed"))
              assert.equal(
                entry.source.applicationMode,
                "native",
                "Completed native source must retain its backend application mode",
              );
            const plan = continuationPlan({
              ...entry,
              evidence: [sourceEvidence],
            });
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
                answer: Object.hasOwn(plan.pending ?? {}, "answer")
                  ? plan.pending.answer
                  : source.pending.answer,
                result: Object.hasOwn(plan.pending ?? {}, "result")
                  ? plan.pending.result
                  : source.pending.result,
                action: plan.pending?.action,
              };
            assert.ok(
              !records.has(source.id),
              "Duplicate row4 source identity",
            );
            records.set(source.id, entry);
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
          const before = await readCapture(source);
          assert.ok(
            Array.isArray(before.frameworkRuns),
            "Capture must include actual framework-bound runs",
          );
          record.thread = await browser.openThread(
            source.mapping.intelligenceId,
            {
              scenarioId: `row4-${source.id}`,
              mode:
                record.source.applicationMode ??
                (source.mode === "native-pending" ? "native" : "rich"),
            },
          );
          const visible = await browser.snapshot(record.thread);
          await save("browser-open", visible);
          assert.equal(
            visible.threadId,
            source.mapping.intelligenceId,
            "Browser did not open imported destination",
          );
          record.captureBefore = await readCapture(source);
          assert.deepEqual(
            record.captureBefore.frameworkRuns.map((run) => run.input.runId),
            before.frameworkRuns.map((run) => run.input.runId),
            "Opening imported history reran the agent",
          );
        },
        followup: act,
        resume: act,
      },
    },
  };
}
