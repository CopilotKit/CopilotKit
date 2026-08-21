import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { EventType } = require("@ag-ui/client");
const { A2AAgent } = require("@ag-ui/a2a");
const { Observable } = require("rxjs");

const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(JSON.stringify({ url: "http://a2a.test" }), {
    headers: { "Content-Type": "application/json" },
  });
const { POST } = require("../src/app/api/copilotkit-a2ui/[[...slug]]/route.ts");
globalThis.fetch = originalFetch;

function createRunRequest(resume) {
  return new Request("http://localhost/api/copilotkit-a2ui/agent/default/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-a2a-runtime-contract",
      runId: "run-a2a-runtime-contract",
      state: {},
      messages: [
        {
          id: "request-message",
          role: "user",
          content: "Continue rendering the restaurant picker",
        },
      ],
      tools: [],
      context: [],
      forwardedProps: { a2uiCatalogAvailable: true },
      resume,
    }),
  });
}

test("the CopilotRuntime request path preserves A2UI middleware and resume for A2A", async (t) => {
  let receivedInput;
  const originalRun = A2AAgent.prototype.run;
  A2AAgent.prototype.run = function (input) {
    receivedInput = input;
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.complete();
    });
  };
  t.after(() => {
    A2AAgent.prototype.run = originalRun;
  });

  const resume = [
    {
      interruptId: "interrupt-1",
      status: "resolved",
      payload: { approved: true },
    },
  ];
  const response = await POST(createRunRequest(resume));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(response.status, 200);
  assert.ok(receivedInput, "the runtime must execute the registered A2A agent");
  assert.deepEqual(receivedInput.resume, resume);
  assert.equal(receivedInput.forwardedProps.injectA2UITool, true);
  assert.ok(
    receivedInput.tools.some((tool) => tool.name === "render_a2ui"),
    "the per-request A2UI middleware must reach the A2A run",
  );
});
