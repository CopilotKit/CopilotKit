import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Install only in the owned test runtime, before constructing its runner.
 * Socket must be the SAME Phoenix export resolved by that runtime package.
 * Capture precedes push; a capture failure prevents an uncaptured send.
 */
export function captureIngestion({ Socket, directory }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "ingestion.jsonl");
  const original = Socket.prototype.channel;
  const installed = function (...args) {
    const channel = original.apply(this, args);
    if (!String(args[0]).startsWith("ingestion:")) return channel;
    const push = channel.push;
    channel.push = function (name, payload, ...rest) {
      if (name === "event" || name === "events") {
        const events = name === "events" ? payload.events : [payload];
        assert.ok(
          Array.isArray(events) && events.length,
          "Empty ingestion push",
        );
        for (const event of events) {
          assert.ok(
            event.metadata?.cpki_event_id,
            "Missing canonical event ID",
          );
          assert.equal(
            event.threadId,
            event.thread_id,
            "Conflicting thread routing",
          );
          assert.equal(event.runId, event.run_id, "Conflicting run routing");
        }
        appendFileSync(
          path,
          JSON.stringify({ topic: args[0], name, payload }) + "\n",
          { mode: 0o600 },
        );
      }
      return push.call(this, name, payload, ...rest);
    };
    return channel;
  };
  Socket.prototype.channel = installed;
  return {
    path,
    restore() {
      assert.equal(
        Socket.prototype.channel,
        installed,
        "Capture hook was replaced",
      );
      Socket.prototype.channel = original;
    },
  };
}

/** Retain every attempt separately; collapse only identical transport retries.
 * No semantic event de-duplication or content rewriting is permitted.
 */
export function readCapture(directory, threadId) {
  let contents;
  try {
    contents = readFileSync(join(directory, "ingestion.jsonl"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { attempts: [], events: [] };
    throw error;
  }
  assert.ok(!contents || contents.endsWith("\n"), "Incomplete capture record");
  const attempts = [];
  const unique = new Map();
  for (const line of contents.split("\n").filter(Boolean)) {
    const record = JSON.parse(line);
    const batch =
      record.name === "events" ? record.payload.events : [record.payload];
    for (const event of batch) {
      if (event.threadId !== threadId) continue;
      attempts.push(event);
      const key = event.metadata.cpki_event_id;
      if (unique.has(key))
        assert.deepEqual(
          event,
          unique.get(key),
          "Retry changed canonical payload",
        );
      else unique.set(key, event);
    }
  }
  return { attempts, events: [...unique.values()] };
}
