import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { wirePlaywrightPage } from "../../../src/probes/drivers/d4-chat-roundtrip.js";

const mode = process.argv[2];
assert.ok(mode === "fulfilled" || mode === "rejecting", "invalid fixture mode");

// Use the actual adapter and the same minimal page boundary as strict.ts.
const events = new EventEmitter();
const page = wirePlaywrightPage({
  goto: async () => null,
  type: async () => {},
  press: async () => {},
  waitForSelector: async () => {},
  textContent: async () => null,
  evaluate: async <R>() => "" as unknown as R,
  close: async () => {},
  on: (event, handler) => {
    events.on(event, handler);
  },
});
const delivered: unknown[] = [];
page.onRequestFailed?.(async (event) => {
  delivered.push(event);
  // The returned Promise settles after the adapter's callback has returned.
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (mode === "rejecting") {
    throw new Error("D4_ASYNC_DIAGNOSTIC_CONSUMER");
  }
});
events.emit("requestfailed", {
  url: () => "https://x.example.com/api/copilotkit",
  failure: () => ({ errorText: "net::ERR_ABORTED" }),
  response: () => Promise.resolve(null),
});
// Allow delivery, delayed settlement, and strict rejection handling to run
// before asserting success. No test-side rejection interception is installed.
for (let turn = 0; turn < 3; turn += 1) {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
assert.deepEqual(delivered, [
  {
    url: "https://x.example.com/api/copilotkit",
    errorClass: "net::ERR_ABORTED",
    responseStatus: null,
  },
]);
process.stdout.write("D4_REQUEST_FAILED_ASYNC_CONSUMER_OK\n");
