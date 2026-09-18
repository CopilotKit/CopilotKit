import assert from "node:assert/strict";
import { test } from "node:test";

import { A2AAgent } from "@ag-ui/a2a";

const agentOrigin = "http://a2a.test.invalid";
const originalAgentUrl = process.env.A2A_AGENT_URL;
const originalFetch = globalThis.fetch;
const transportRequests = [];

process.env.A2A_AGENT_URL = agentOrigin;
globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );

  assert.equal(
    requestUrl.origin,
    agentOrigin,
    `unexpected external network request: ${requestUrl.href}`,
  );

  if (requestUrl.pathname === "/.well-known/agent.json") {
    return Response.json({
      name: "A2UI test agent",
      description: "Deterministic A2A transport fixture",
      url: `${agentOrigin}/rpc`,
      version: "1.0.0",
      capabilities: { streaming: true },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      skills: [],
    });
  }

  assert.equal(requestUrl.pathname, "/rpc");
  assert.equal(init?.method, "POST");
  assert.equal(typeof init?.body, "string");

  const rpcRequest = JSON.parse(init.body);
  const headers = new Headers(init.headers);
  transportRequests.push({
    method: rpcRequest.method,
    extensions: headers.get("X-A2A-Extensions"),
  });

  const rpcResponse = {
    jsonrpc: "2.0",
    id: rpcRequest.id,
    result: {
      kind: "message",
      messageId: "a2a-response-message",
      role: "agent",
      parts: [{ kind: "text", text: "Rendered" }],
    },
  };

  return new Response(`data: ${JSON.stringify(rpcResponse)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
};

const { POST } =
  await import("../src/app/api/copilotkit-a2ui/[[...slug]]/route.ts");

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

async function consumeResponse(response) {
  assert.ok(response.body, "the runtime must return an event stream");
  const reader = response.body.getReader();
  let chunkCount = 0;

  while (true) {
    const { done } = await reader.read();
    if (done) {
      break;
    }
    chunkCount += 1;
  }

  assert.ok(chunkCount > 0, "the runtime event stream must produce output");
}

test("the CopilotRuntime POST path preserves resume and A2UI middleware for A2A transport", async (t) => {
  let receivedInput;
  const originalRun = A2AAgent.prototype.run;

  A2AAgent.prototype.run = function (input) {
    receivedInput = input;
    return originalRun.call(this, input);
  };

  t.after(() => {
    A2AAgent.prototype.run = originalRun;
    globalThis.fetch = originalFetch;
    if (originalAgentUrl === undefined) {
      delete process.env.A2A_AGENT_URL;
    } else {
      process.env.A2A_AGENT_URL = originalAgentUrl;
    }
  });

  const resume = [
    {
      interruptId: "interrupt-1",
      status: "resolved",
      payload: { approved: true },
    },
  ];
  const response = await POST(createRunRequest(resume));
  await consumeResponse(response);

  assert.equal(response.status, 200);
  assert.ok(receivedInput, "the runtime must execute the registered A2A agent");
  assert.deepEqual(receivedInput.resume, resume);
  assert.equal(receivedInput.forwardedProps.injectA2UITool, true);
  assert.ok(
    receivedInput.tools.some((tool) => tool.name === "render_a2ui"),
    "the per-request A2UI middleware must reach the A2A transport boundary",
  );
  assert.deepEqual(transportRequests, [
    {
      method: "message/stream",
      extensions: "https://a2ui.org/a2a-extension/a2ui/v0.8",
    },
  ]);
});
