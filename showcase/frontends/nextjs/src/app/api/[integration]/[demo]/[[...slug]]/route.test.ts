import { randomUUID } from "node:crypto";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { Event as AgUiEvent, RunAgentInput } from "@ag-ui/client";
import { TranscriptionService } from "@copilotkit/runtime/v2";
import { from } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardedHeaders, httpAgent } from "@/lib/agents";
import type {
  IntegrationEnv,
  IntegrationRuntime,
  RuntimeOptions,
} from "@/lib/agents";
import { DEMO_AUTH_HEADER } from "@/lib/demo-auth";
import {
  DEMO_AUTH_HOOKS,
  VOICE_RUNTIME_OPTIONS,
  createDemoRouteHandler,
} from "./runtime-handler";
import type { DemoRouteSettings, DemoTarget } from "./runtime-handler";

// The routes load integrations through `loadIntegration`. These tests pass
// fake integrations through that seam instead, so they never touch
// src/integrations. Everything after it is real: the CopilotKit runtime, its
// two transports, DEMO_RUNTIME_OPTIONS and the agents' event streams.

// An in-process agent that answers each run with one assistant message,
// written by `reply`. The runtime clones the agent for each request.
class ReplyAgent extends AbstractAgent {
  // The runtime copies forwarded headers onto each clone, as it does onto an
  // HttpAgent, which sends them.
  headers: Record<string, string> = {};
  private readonly reply: (agent: ReplyAgent) => string;

  constructor(reply: (agent: ReplyAgent) => string) {
    super();
    this.reply = reply;
  }

  clone() {
    return new ReplyAgent(this.reply);
  }

  run({ threadId, runId }: RunAgentInput) {
    const messageId = `${runId}-reply`;
    const events: AgUiEvent[] = [
      { type: EventType.RUN_STARTED, threadId, runId },
      { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: this.reply(this),
      },
      { type: EventType.TEXT_MESSAGE_END, messageId },
      { type: EventType.RUN_FINISHED, threadId, runId },
    ];
    return from(events);
  }
}

class FixedTranscription extends TranscriptionService {
  private readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  async transcribeFile() {
    return this.text;
  }
}

/** One fake integration: its env.ts and its createRuntimeConfig. */
interface FakeIntegration {
  env?: IntegrationEnv;
  createRuntimeConfig: IntegrationRuntime["createRuntimeConfig"];
}

type Handle = ReturnType<typeof createDemoRouteHandler>;

const AGENTIC_CHAT = { integration: "fake", demo: "agentic-chat" };

// A runtime route over fake integrations, by slug.
function routeOver(
  integrations: Partial<Record<string, FakeIntegration>>,
  settings: Omit<DemoRouteSettings, "loadIntegration"> = {},
) {
  return createDemoRouteHandler({
    ...settings,
    loadIntegration: async (slug) => {
      const integration = integrations[slug];
      if (integration === undefined) return undefined;
      const runtime = {
        createRuntimeConfig: integration.createRuntimeConfig,
      };
      return { env: integration.env ?? {}, runtime };
    },
  });
}

// One agent, agentic_chat, that answers "hello".
function helloConfig() {
  return { agents: { agentic_chat: new ReplyAgent(() => "hello") } };
}

// An integration, "fake", that serves every demo with helloConfig.
function helloIntegration(
  settings: Omit<DemoRouteSettings, "loadIntegration"> = {},
) {
  return routeOver({ fake: { createRuntimeConfig: helloConfig } }, settings);
}

function send(
  handle: Handle,
  target: DemoTarget,
  path: string,
  init?: RequestInit,
) {
  const url = `http://localhost/api/${target.integration}/${target.demo}${path}`;
  return handle(new Request(url, init), target);
}

function postJson(
  handle: Handle,
  target: DemoTarget,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  return send(handle, target, path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function jsonOf(response: Response) {
  return { status: response.status, body: await response.json() };
}

// A run of agentic_chat on a new thread.
function runInput() {
  const id = randomUUID();
  return {
    threadId: `thread-${id}`,
    runId: `run-${id}`,
    state: {},
    messages: [{ id: `message-${id}`, role: "user", content: "Hi" }],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function runEnvelope() {
  return {
    method: "agent/run",
    params: { agentId: "agentic_chat" },
    body: runInput(),
  };
}

interface StreamedEvent {
  type: string;
  delta?: string;
}

// The text of the assistant messages in a run's SSE stream.
async function replyText(response: Response) {
  const lines = (await response.text()).split("\n");
  const events: StreamedEvent[] = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => event.delta)
    .join("");
}

beforeEach(() => {
  // The runtime would send usage events over the network.
  vi.stubEnv("COPILOTKIT_TELEMETRY_DISABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createDemoRouteHandler", () => {
  it("answers 404 for an integration that no manifest has", async () => {
    const handle = helloIntegration();
    const target = { integration: "no-such-integration", demo: "agentic-chat" };

    expect(await jsonOf(await send(handle, target, "/info"))).toEqual({
      status: 404,
      body: { error: "unknown integration" },
    });
  });

  it("answers 404 with the address variables that are not set", async () => {
    vi.stubEnv("AGENT_URL_FAKE", "http://fake:8000");
    vi.stubEnv("LANGGRAPH_DEPLOYMENT_URL_FAKE", undefined);
    const handle = routeOver({
      fake: {
        env: {
          AGENT_URL_FAKE: { port: 8000 },
          LANGGRAPH_DEPLOYMENT_URL_FAKE: { port: 8123 },
        },
        createRuntimeConfig: helloConfig,
      },
    });

    expect(await jsonOf(await send(handle, AGENTIC_CHAT, "/info"))).toEqual({
      status: 404,
      body: {
        error: "unconfigured",
        missing: ["LANGGRAPH_DEPLOYMENT_URL_FAKE"],
      },
    });
  });

  it("answers 404 unconfigured when an agent reads a variable that env.ts does not list", async () => {
    vi.stubEnv("AGENT_URL_FAKE", undefined);
    const handle = routeOver({
      fake: {
        createRuntimeConfig: () => ({
          agents: { agentic_chat: httpAgent("fake") },
        }),
      },
    });

    expect(await jsonOf(await send(handle, AGENTIC_CHAT, "/info"))).toEqual({
      status: 404,
      body: { error: "unconfigured", missing: ["AGENT_URL_FAKE"] },
    });
  });

  it("answers 404 for a demo that the integration does not serve", async () => {
    const handle = routeOver({
      fake: { createRuntimeConfig: () => undefined },
    });

    expect(await jsonOf(await send(handle, AGENTIC_CHAT, "/info"))).toEqual({
      status: 404,
      body: { error: "unknown demo" },
    });
  });

  it("answers 500 with an error id only, and logs the error under that id", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("agent setup failed at http://internal:8000");
    const handle = routeOver({
      fake: {
        createRuntimeConfig: () => {
          throw failure;
        },
      },
    });

    const { status, body } = await jsonOf(
      await send(handle, AGENTIC_CHAT, "/info"),
    );

    expect(status).toBe(500);
    expect(body).toEqual({
      error: "internal runtime error",
      errorId: expect.any(String),
    });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(body.errorId),
      failure,
    );
  });

  it.each([
    ["single-route", "", runEnvelope],
    ["REST", "/agent/agentic_chat/run", runInput],
  ])("runs the demo's agent over the %s transport", async (_, path, body) => {
    const response = await postJson(
      helloIntegration(),
      AGENTIC_CHAT,
      path,
      body(),
    );

    expect(response.status).toBe(200);
    expect(await replyText(response)).toBe("hello");
  });

  it("gives the agent the request's x-* headers, as headers and through forwardedHeaders()", async () => {
    const echoAgent = new ReplyAgent(
      (agent) =>
        `${agent.headers["x-aimock-context"]} ${forwardedHeaders()["x-aimock-context"]}`,
    );
    const handle = routeOver({
      fake: {
        createRuntimeConfig: () => ({ agents: { agentic_chat: echoAgent } }),
      },
    });

    const response = await postJson(handle, AGENTIC_CHAT, "", runEnvelope(), {
      "X-AIMock-Context": "fake-fixture",
    });

    expect(await replyText(response)).toBe("fake-fixture fake-fixture");
  });

  it("builds one runtime for each integration and demo, on its first request", async () => {
    const built: string[] = [];
    const recording = (slug: string) => ({
      createRuntimeConfig: (demoId: string) => {
        built.push(`${slug}/${demoId}`);
        return helloConfig();
      },
    });
    const handle = routeOver({
      fake: recording("fake"),
      other: recording("other"),
    });

    await send(handle, AGENTIC_CHAT, "/info");
    await send(handle, AGENTIC_CHAT, "/info");
    await send(handle, { integration: "other", demo: "agentic-chat" }, "/info");
    await send(handle, { integration: "fake", demo: "chat-slots" }, "/info");

    expect(built).toEqual([
      "fake/agentic-chat",
      "other/agentic-chat",
      "fake/chat-slots",
    ]);
  });

  const mergeCases: [
    string,
    RuntimeOptions,
    RuntimeOptions | undefined,
    boolean,
  ][] = [
    ["the demo's DEMO_RUNTIME_OPTIONS entry", {}, undefined, true],
    [
      "the route's options over the demo's entry",
      { openGenerativeUI: false },
      undefined,
      false,
    ],
    [
      "the integration's options over the demo's entry",
      {},
      { openGenerativeUI: false },
      false,
    ],
    [
      "the integration's options over the route's",
      { openGenerativeUI: false },
      { openGenerativeUI: true },
      true,
    ],
  ];

  it.each(mergeCases)(
    "applies %s",
    async (_, runtimeOptions, integrationOptions, enabled) => {
      const handle = routeOver(
        {
          fake: {
            createRuntimeConfig: () => ({
              ...helloConfig(),
              options: integrationOptions,
            }),
          },
        },
        { runtimeOptions },
      );
      const openGenUi = { integration: "fake", demo: "open-gen-ui" };

      const { body } = await jsonOf(await send(handle, openGenUi, "/info"));

      expect(body.openGenerativeUIEnabled).toBe(enabled);
    },
  );
});

describe("DEMO_AUTH_HOOKS", () => {
  const auth = { integration: "fake", demo: "auth" };

  it.each([
    ["no Authorization header", {}],
    ["another token", { Authorization: "Bearer someone-else" }],
  ])("answers 401 to a request with %s", async (_, headers) => {
    const handle = helloIntegration({ hooks: DEMO_AUTH_HOOKS });

    expect(
      await jsonOf(await send(handle, auth, "/info", { headers })),
    ).toMatchObject({
      status: 401,
      body: { error: "unauthorized" },
    });
  });

  it("passes a request with the demo's Authorization header", async () => {
    const handle = helloIntegration({ hooks: DEMO_AUTH_HOOKS });
    const headers = { Authorization: DEMO_AUTH_HEADER };

    const response = await send(handle, auth, "/info", { headers });

    expect(response.status).toBe(200);
  });
});

describe("VOICE_RUNTIME_OPTIONS", () => {
  const voice = { integration: "fake", demo: "voice" };
  const audio = {
    audio: Buffer.from("a few bytes of audio").toString("base64"),
    mimeType: "audio/webm",
  };

  it("answers a transcription with 401 when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    // A call to OpenAI could not connect here and would answer 500, so a 401
    // can only come from the missing key.
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:9/v1");
    const handle = helloIntegration({ runtimeOptions: VOICE_RUNTIME_OPTIONS });

    const response = await postJson(handle, voice, "/transcribe", audio);

    expect(await jsonOf(response)).toMatchObject({
      status: 401,
      body: { error: "auth_failed" },
    });
  });

  it("gives way to the integration's own transcription service", async () => {
    const handle = routeOver(
      {
        fake: {
          createRuntimeConfig: () => ({
            ...helloConfig(),
            options: {
              transcriptionService: new FixedTranscription(
                "from the integration",
              ),
            },
          }),
        },
      },
      { runtimeOptions: VOICE_RUNTIME_OPTIONS },
    );

    const response = await postJson(handle, voice, "/transcribe", audio);

    expect(await jsonOf(response)).toMatchObject({
      status: 200,
      body: { text: "from the integration" },
    });
  });
});
