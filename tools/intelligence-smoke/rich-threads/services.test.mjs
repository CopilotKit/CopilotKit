import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServices } from "./row1/services.mjs";

test("failed browser actions retain partial independent source evidence and close their context", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "rich-failure-control-"));
  const thread = { threadId: "partial-thread" };
  const source = {
    events: [{ type: "RUN_STARTED", runId: "interrupted-run" }],
    frameworkRuns: [],
  };
  let closed = false;
  try {
    const { services } = await createServices({
      framework: "mastra",
      scope: { scenarios: [] },
      outputDir,
      capture: {
        read: async (id) => {
          assert.equal(id, thread.threadId);
          return source;
        },
      },
      browser: {
        newThread: async () => thread,
        send: async () => {
          throw new Error("Actual browser control failed");
        },
        snapshot: async () => ({
          screenshots: ["failed/browser-1.png"],
          text: "partially rendered",
        }),
        closeThread: async (value) => {
          assert.equal(value, thread);
          closed = true;
        },
      },
    });
    await assert.rejects(
      services.row1.runFresh({
        id: "failed",
        steps: [{ kind: "send", prompt: "hello" }],
      }),
      (error) => {
        assert.match(error.message, /Actual browser control failed/);
        assert.deepEqual(error.evidence, ["failed/failure.json"]);
        return true;
      },
    );
    const evidence = JSON.parse(
      await readFile(join(outputDir, "failed/failure.json"), "utf8"),
    );
    assert.deepEqual(evidence.source, source);
    assert.equal(evidence.browser.text, "partially rendered");
    assert.equal(closed, true);
  } finally {
    await rm(outputDir, { recursive: true });
  }
});
