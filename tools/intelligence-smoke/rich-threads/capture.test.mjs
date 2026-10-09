import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureIngestion,
  captureFramework,
  readCapture,
} from "./capture/runtime-agent.mjs";

const event = (id) => ({
  type: "TEXT_MESSAGE_CONTENT",
  threadId: "thread",
  thread_id: "thread",
  runId: "run",
  run_id: "run",
  messageId: "message",
  delta: "same",
  metadata: { cpki_event_id: id },
});

test("canonical capture precedes transport, preserves occurrences, and rejects changed retries", () => {
  const directory = mkdtempSync(join(tmpdir(), "ingestion-test-"));
  let sends = 0;
  class Socket {
    channel() {
      return {
        push() {
          sends++;
          assert.equal(
            readCapture(directory, "thread").attempts.length,
            sends === 1 ? 2 : sends + 1,
          );
          return "push-result";
        },
      };
    }
  }
  const hook = captureIngestion({ Socket, directory });
  try {
    const channel = new Socket().channel("ingestion:run");
    assert.equal(
      channel.push("events", { events: [event("1"), event("2")] }),
      "push-result",
    );
    channel.push("event", event("1"));
    assert.equal(readCapture(directory, "thread").events.length, 2);
    assert.equal(readCapture(directory, "other").events.length, 0);
    assert.throws(
      () => channel.push("event", { ...event("1"), delta: "changed" }),
      /Retry changed/,
    );
    assert.throws(() => readCapture(directory, "thread"), /Retry changed/);
  } finally {
    hook.restore();
    rmSync(directory, { recursive: true });
  }
});

test("native input and output capture survives later middleware mutation without ingestion", () => {
  const directory = mkdtempSync(join(tmpdir(), "framework-capture-"));
  const output = event("native");
  const input = { threadId: "thread", runId: "run", messages: [] };
  const agent = {
    run() {
      return {
        pipe(observer) {
          observer.next(output);
          observer.complete();
        },
      };
    },
  };
  try {
    captureFramework({ agent, directory, tap: (observer) => observer });
    agent.run(input);
    output.delta = "mutated";
    input.messages.push({ role: "user", content: "later" });
    const captured = readCapture(directory, "thread");
    assert.equal(captured.events.length, 0);
    assert.equal(captured.frameworkRuns[0].events[0].delta, "same");
    assert.deepEqual(captured.frameworkRuns[0].input.messages, []);
    assert.equal(captured.frameworkRuns[0].complete, true);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
