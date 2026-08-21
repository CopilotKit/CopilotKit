import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { RuntimeA2AAgent } = require("../src/app/api/runtime-a2a-agent.ts");
const BaseA2AAgent = Object.getPrototypeOf(RuntimeA2AAgent);

const originalMessage = {
  id: "original-message",
  role: "user",
  content: "Build a restaurant picker",
};

const fakeA2AClient = {
  async sendMessage() {
    throw new Error("network behavior is outside this isolation contract");
  },
  sendMessageStream() {
    throw new Error("network behavior is outside this isolation contract");
  },
};

function createAgent() {
  return new RuntimeA2AAgent({
    // The adapter only retains and forwards the client; network behavior belongs
    // to @ag-ui/a2a and is intentionally outside this isolation contract.
    a2aClient: fakeA2AClient,
    agentId: "a2ui",
    description: "A2UI agent",
    initialMessages: [originalMessage],
    initialState: { selection: "original" },
    threadId: "original-thread",
  });
}

test("cloning the runtime adapter preserves configuration without sharing request state", () => {
  const agent = createAgent();

  const clone = agent.clone();

  assert.ok(clone instanceof RuntimeA2AAgent);
  assert.notStrictEqual(clone, agent);
  assert.equal(clone.agentId, agent.agentId);
  assert.equal(clone.description, agent.description);
  assert.equal(clone.threadId, agent.threadId);
  assert.deepEqual(clone.messages, agent.messages);
  assert.deepEqual(clone.state, agent.state);

  clone.threadId = "clone-thread";
  clone.setMessages([
    { id: "clone-message", role: "user", content: "Clone request" },
  ]);
  clone.setState({ selection: "clone" });

  assert.equal(agent.threadId, "original-thread");
  assert.deepEqual(agent.messages, [originalMessage]);
  assert.deepEqual(agent.state, { selection: "original" });
});

test("each runtime request uses a fresh A2A agent with request-local state", async (t) => {
  const agent = createAgent();
  let isolatedAgent;
  let forwardedParameters;
  let forwardedSubscriber;
  const originalRunAgent = BaseA2AAgent.prototype.runAgent;

  BaseA2AAgent.prototype.runAgent = async function (parameters, subscriber) {
    isolatedAgent = this;
    forwardedParameters = parameters;
    forwardedSubscriber = subscriber;
    return { result: "ok", newMessages: this.messages };
  };
  t.after(() => {
    BaseA2AAgent.prototype.runAgent = originalRunAgent;
  });

  const requestMessage = {
    id: "request-message",
    role: "user",
    content: "Request-local prompt",
  };

  await agent.runAgent({
    context: [],
    forwardedProps: { tenant: "demo" },
    messages: [requestMessage],
    runId: "run-1",
    state: { selection: "request" },
    threadId: "request-thread",
  });

  assert.ok(isolatedAgent instanceof BaseA2AAgent);
  assert.notStrictEqual(isolatedAgent, agent);
  assert.equal(isolatedAgent.threadId, "request-thread");
  assert.deepEqual(isolatedAgent.messages, [requestMessage]);
  assert.deepEqual(isolatedAgent.state, { selection: "request" });
  assert.deepEqual(forwardedParameters, {
    context: [],
    forwardedProps: { tenant: "demo" },
    runId: "run-1",
    tools: undefined,
  });
  assert.equal(forwardedSubscriber, undefined);

  assert.equal(agent.threadId, "original-thread");
  assert.deepEqual(agent.messages, [originalMessage]);
  assert.deepEqual(agent.state, { selection: "original" });
});
