import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { wirePlaywrightPage } from "../../../src/probes/drivers/d4-chat-roundtrip.js";

// Real production adapter, with only the browser event boundary replaced.
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
page.onRequestFailed?.((event) => {
  delivered.push(event);
  throw new Error("diagnostic consumer failed");
});
let rejectResponse!: (error: Error) => void;
const response = new Promise<null>((_, reject) => {
  rejectResponse = reject;
});
events.emit("requestfailed", {
  url: () => "https://x.example.com/api/copilotkit",
  failure: () => ({ errorText: "net::ERR_ABORTED" }),
  response: () => response,
});
// Rejection occurs after EventEmitter has returned; no test-side pre-catch.
await new Promise<void>((resolve) => setImmediate(resolve));
rejectResponse(new Error("Target page, context or browser has been closed"));
await new Promise<void>((resolve) => setImmediate(resolve));
assert.deepEqual(delivered, [
  {
    url: "https://x.example.com/api/copilotkit",
    errorClass: "net::ERR_ABORTED",
    responseStatus: null,
  },
]);
process.stdout.write("D4_REQUEST_FAILED_DIAGNOSTIC_OK\n");
