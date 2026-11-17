// The agents of built-in-agent and mastra run in this process and call the
// LLM themselves. These tests build them for every demo, and run one of them
// against a fake LLM: `fetch` is replaced, so nothing reaches the network.
import { Socket } from "node:net";
import { AbstractAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { lastValueFrom, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import builtInAgent from "@/integrations/built-in-agent/agents";
import mastra from "@/integrations/mastra/agents";
import { withForwardedHeaders } from "@/lib/agents";
import { getIntegration } from "@/lib/registry";

const INTEGRATIONS = [
  { slug: "built-in-agent", runtime: builtInAgent },
  { slug: "mastra", runtime: mastra },
];

// The ids of the demos that the app serves for `slug`, extra demos included.
function servedDemoIds(slug: string) {
  const integration = getIntegration(slug);
  if (integration === undefined) throw new Error(`No manifest has ${slug}.`);
  return integration.demos.map((demo) => demo.id);
}

// The demos that some page has but `slug` does not serve.
function unservedDemoIds(slug: string) {
  const served = new Set(servedDemoIds(slug));
  return Object.keys(DEMO_AGENT_IDS).filter((demo) => !served.has(demo));
}

// The Server-Sent Events of an OpenAI Responses stream that answers "Hello".
const HELLO_EVENTS = [
  {
    type: "response.created",
    response: {
      id: "resp_1",
      object: "response",
      created_at: 0,
      model: "gpt-6-luna",
      status: "in_progress",
      output: [],
    },
  },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "in_progress",
      content: [],
    },
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_1",
    output_index: 0,
    content_index: 0,
    delta: "Hello",
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Hello", annotations: [] }],
    },
  },
  {
    type: "response.completed",
    response: {
      id: "resp_1",
      object: "response",
      created_at: 0,
      model: "gpt-6-luna",
      status: "completed",
      output: [],
      incomplete_details: null,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  },
];

// Stands in for the network: every call gets the "Hello" stream.
const fakeFetch = vi.fn<typeof fetch>(async () => {
  const body = HELLO_EVENTS.map(
    (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  ).join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
});

// The headers of the LLM calls that the fake received.
function llmCallHeaders() {
  return fakeFetch.mock.calls
    .filter(([input]) => String(input).endsWith("/responses"))
    .map(([, init]) => new Headers(init?.headers));
}

function runInput(): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [{ id: "message-1", role: "user", content: "Hi" }],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

// The agent that `runtime` builds for one demo's page.
function agentOf(
  runtime: (typeof INTEGRATIONS)[number]["runtime"],
  demo: string,
) {
  const agentId = DEMO_AGENT_IDS[demo]?.[0];
  const agent = agentId && runtime.createRuntimeConfig(demo)?.agents[agentId];
  if (!agent) throw new Error(`No agent for ${demo}.`);
  return agent;
}

// Lets the work that building started, such as opening stores, take its
// first steps.
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  // Mastra keeps working memory in memory, so no database file is written.
  vi.stubEnv("MASTRA_WORKING_MEMORY_URL", ":memory:");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fakeFetch.mockClear();
});

describe.each(INTEGRATIONS)("$slug", ({ slug, runtime }) => {
  it("builds the agents of every demo it serves without a network call", async () => {
    const connect = vi.spyOn(Socket.prototype, "connect");

    const configs = servedDemoIds(slug).map((demo) =>
      runtime.createRuntimeConfig(demo),
    );
    await settle();

    expect(configs).not.toContain(undefined);
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(servedDemoIds(slug))(
    "registers the agent ids that the %s page uses",
    (demo) => {
      const agents = runtime.createRuntimeConfig(demo)?.agents ?? {};

      expect(Object.keys(agents)).toEqual(DEMO_AGENT_IDS[demo]);
      for (const agent of Object.values(agents)) {
        expect(agent).toBeInstanceOf(AbstractAgent);
      }
    },
  );

  it.each(["no-such-demo", ...unservedDemoIds(slug)])(
    "returns undefined for %s, which it does not serve",
    (demo) => {
      expect(runtime.createRuntimeConfig(demo)).toBeUndefined();
    },
  );

  it("adds the request's x-* headers to its LLM calls", async () => {
    const agent = agentOf(runtime, "agentic-chat");
    const request = new Request("http://localhost/api/agentic-chat", {
      headers: {
        "X-AIMock-Context": "agents-in-process",
        "X-Test-Id": "header-check",
      },
    });

    await withForwardedHeaders(request, () =>
      lastValueFrom(agent.run(runInput()).pipe(toArray())),
    );

    const calls = llmCallHeaders();
    expect(calls).not.toEqual([]);
    for (const headers of calls) {
      expect(headers.get("x-aimock-context")).toBe("agents-in-process");
      expect(headers.get("x-test-id")).toBe("header-check");
    }
  });
});
