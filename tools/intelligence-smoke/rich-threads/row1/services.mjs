import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { scenarios } from "../scenarios/row1.mjs";
import { projectEvents } from "../capture/project.mjs";
import { artifactWriter } from "../contract.mjs";

export async function createServices({
  scope,
  browser,
  intelligence,
  capture,
  signal,
  dependencies,
  outputDir,
}) {
  const write = artifactWriter(outputDir);
  const project = (events) => projectEvents({ events, ...dependencies });
  async function runFresh(scenario) {
    const thread = await browser.newThread({
      scenarioId: scenario.id,
      mode: "rich",
    });
    try {
      for (const step of scenario.steps) {
        signal?.throwIfAborted();
        assert.equal(
          step.kind,
          "send",
          "Only declared text input is included in this milestone",
        );
        await browser.send(thread, step.prompt);
      }
      const source = await capture.read(thread.threadId);
      await write(`${scenario.id}/source.json`, source);
      const emitted = {
        threadId: thread.threadId,
        agentId: scope.agentId,
        userId: scope.userId,
        runIds: [...new Set(source.events.map((event) => event.runId))],
        events: source.events,
        ...(await project(source.events)),
      };
      const response = emitted.messages.findLast(
        (message) =>
          message.role === "assistant" &&
          typeof message.content === "string" &&
          message.content.trim(),
      );
      assert.ok(response, "No live assistant reply emitted");
      const visible = thread.page
        .getByText(response.content, { exact: false })
        .last();
      await visible.waitFor({ state: "visible", timeout: 30_000 });
      const observed = await browser.snapshot(thread);
      observed.assistantText = await visible.innerText();
      return {
        emitted,
        browser: observed,
        frameworkRuns: source.frameworkRuns,
      };
    } catch (error) {
      const failure = { error: String(error) };
      try {
        failure.source = thread.threadId
          ? await capture.read(thread.threadId)
          : null;
      } catch (captureError) {
        failure.captureError = String(captureError);
      }
      try {
        failure.browser = await browser.snapshot(thread);
      } catch (browserError) {
        failure.browserError = String(browserError);
      }
      const evidence = await write(`${scenario.id}/failure.json`, failure);
      throw Object.assign(new Error(String(error), { cause: error }), {
        evidence: [evidence],
      });
    } finally {
      await browser.closeThread(thread);
    }
  }
  async function readSaved(emitted) {
    const deadline = Date.now() + 30_000;
    let saved;
    do {
      signal?.throwIfAborted();
      if (await intelligence.exists(emitted.threadId)) {
        saved = await intelligence.read(emitted.threadId);
        const ids = new Set(
          saved.events.map((event) => event.metadata.cpki_event_id),
        );
        if (
          emitted.events.every((event) => ids.has(event.metadata.cpki_event_id))
        )
          break;
      }
      await delay(250, undefined, { signal });
    } while (Date.now() < deadline);
    assert.ok(saved, "Thread did not become durable within 30s");
    const projection = await project(saved.events);
    // Public API messages remain independent of the raw-event consumer.
    return { ...saved, state: projection.state, pending: projection.pending };
  }
  return {
    fixture: { row1: { scenarios: scenarios() } },
    services: { row1: { runFresh, readSaved } },
  };
}
