// The agents of ms-agent-dotnet and ms-agent-harness-dotnet, checked against
// the route files of each integration's own website
// (showcase/integrations/<slug>/src/app/api/**/route.ts). The agent server is
// fake: `fetch` is stubbed, and the server answers with a fixed event stream.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { EventType, HttpAgent } from "@ag-ui/client";
import type {
  AbstractAgent,
  Event as AgUiEvent,
  BaseEvent,
  Context,
  Message,
  RunAgentInput,
  ToolCall,
} from "@ag-ui/client";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import msAgentDotnet from "@/integrations/ms-agent-dotnet/agents";
import msAgentDotnetEnv from "@/integrations/ms-agent-dotnet/env";
import msAgentHarnessDotnet from "@/integrations/ms-agent-harness-dotnet/agents";
import msAgentHarnessDotnetEnv from "@/integrations/ms-agent-harness-dotnet/env";
import type { IntegrationRuntime } from "@/lib/agents";
import {
  DotnetMultimodalHttpAgent,
  OpenGenUiHttpAgent,
} from "@/lib/dotnet-http-agents";
import { getIntegration } from "@/lib/registry";

// The address that the tests give each integration's AGENT_URL_<SLUG>.
const AGENT_SERVER = "http://dotnet-agent.test:8000";

const INTEGRATIONS = [
  {
    slug: "ms-agent-dotnet",
    runtime: msAgentDotnet,
    env: msAgentDotnetEnv,
    variable: "AGENT_URL_MS_AGENT_DOTNET",
  },
  {
    slug: "ms-agent-harness-dotnet",
    runtime: msAgentHarnessDotnet,
    env: msAgentHarnessDotnetEnv,
    variable: "AGENT_URL_MS_AGENT_HARNESS_DOTNET",
  },
];

// What an agent does besides sending the run as it is. probe() finds them.
// - "untag": takes `__ck_run_<id>` tags off the request's tool call ids.
// - "untag-ogui": takes `__ogui_run_<id>` tags off them.
// - "tag <tool>": tags the `<tool>` calls in the run's events with
//   `__ck_run_<runId>`.
// - "tag-ogui generateSandboxedUi": tags those calls with `__ogui_run_<runId>`.
// - "steps": streams set_steps arguments into state.steps, and hides the call.
// - "document": streams write_document arguments into state.document, and
//   hides the call.
// - "app-context": sends the page's context as a system message.
// - "preferences": sends the preferences in state as a system message.
// - "reasoning": adds a reasoning message to the run's events.
// - "no-reasoning-input": leaves reasoning messages out of the request.
interface RouteAgent {
  agentClass: typeof HttpAgent;
  path: string;
  effects: string[];
  optionKeys: string[];
}

// An agent that sends the run as it is.
function plain(path: string, agentClass = HttpAgent) {
  return { agentClass, path, effects: [], optionKeys: [] };
}

// An agent of the shared /api/copilotkit route, which takes run tags off.
function untagging(path: string, ...effects: string[]) {
  return {
    agentClass: HttpAgent,
    path,
    effects: ["untag", ...effects],
    optionKeys: [],
  };
}

const REASONING = ["reasoning", "no-reasoning-input"];

// Each demo's agent in the route files, by demo id. Both integrations have
// the same routes, except for the demos that only ms-agent-dotnet serves.
const ROUTE_AGENTS: Partial<Record<string, RouteAgent>> = {
  "a2ui-fixed-schema": plain("/a2ui-fixed-schema"),
  "a2ui-recovery": plain("/a2ui-recovery"),
  "agent-config": plain("/agent-config"),
  "agentic-chat": untagging("/"),
  auth: plain("/"),
  "beautiful-chat": plain("/beautiful-chat"),
  "chat-customization-css": untagging("/"),
  "chat-slots": untagging("/"),
  "declarative-gen-ui": plain("/declarative-gen-ui"),
  "declarative-hashbrown": plain("/byoc-hashbrown"),
  "declarative-json-render": plain("/byoc-json-render"),
  "frontend-tools": untagging("/"),
  "frontend-tools-async": untagging("/"),
  "gen-ui-agent": untagging("/gen-ui-agent", "steps"),
  "gen-ui-interrupt": untagging("/interrupt-adapted", "tag schedule_meeting"),
  "gen-ui-tool-based": untagging("/gen-ui-tool-based"),
  "headless-complete": plain("/headless-complete"),
  "headless-simple": untagging("/"),
  hitl: untagging("/", "tag generate_task_steps"),
  "hitl-in-app": untagging("/hitl-in-app", "tag request_user_approval"),
  "hitl-in-chat": untagging("/hitl-in-chat", "tag book_call"),
  "interrupt-headless": untagging("/interrupt-adapted", "tag schedule_meeting"),
  "mcp-apps": plain("/mcp-apps/"),
  multimodal: plain("/multimodal", DotnetMultimodalHttpAgent),
  "open-gen-ui": {
    ...plain("/open-gen-ui", OpenGenUiHttpAgent),
    effects: ["untag-ogui", "tag-ogui generateSandboxedUi"],
  },
  "open-gen-ui-advanced": {
    ...plain("/open-gen-ui-advanced", OpenGenUiHttpAgent),
    effects: ["untag-ogui", "tag-ogui generateSandboxedUi"],
  },
  "prebuilt-popup": untagging("/"),
  "prebuilt-sidebar": untagging("/"),
  "readonly-state-agent-context": untagging(
    "/readonly-state-agent-context",
    "app-context",
  ),
  "reasoning-custom": untagging("/reasoning", ...REASONING),
  "reasoning-default": untagging("/reasoning", ...REASONING),
  "shared-state-read": untagging("/"),
  "shared-state-read-write": untagging(
    "/shared-state-read-write",
    "preferences",
  ),
  // ms-agent-dotnet's route streams write_document into state. The harness
  // server has the same tool, so its agent does the same.
  "shared-state-streaming": untagging("/shared-state-streaming", "document"),
  subagents: untagging("/subagents"),
  "threadid-frontend-tool-roundtrip": untagging("/"),
  "tool-rendering": untagging("/tool-rendering"),
  "tool-rendering-custom-catchall": untagging("/tool-rendering"),
  "tool-rendering-default-catchall": untagging("/tool-rendering"),
  "tool-rendering-reasoning-chain": untagging(
    "/tool-rendering-reasoning-chain",
    ...REASONING,
  ),
  voice: { ...plain("/voice/"), optionKeys: ["transcriptionService"] },
};

function routeAgent(demoId: string) {
  const agent = ROUTE_AGENTS[demoId];
  if (agent === undefined) throw new Error(`No route agent for ${demoId}.`);
  return agent;
}

// The ids of the demos that the app serves for `slug`: the manifest's, then
// the extra demos.
function servedDemoIds(slug: string) {
  const integration = getIntegration(slug);
  if (integration === undefined) throw new Error(`No manifest has ${slug}.`);
  return integration.demos.map((demo) => demo.id);
}

function configOf(runtime: IntegrationRuntime, demoId: string) {
  const config = runtime.createRuntimeConfig(demoId);
  if (config === undefined) throw new Error(`No config for ${demoId}.`);
  return config;
}

// The demo's agent. Every .NET demo has one.
function agentOf(runtime: IntegrationRuntime, demoId: string) {
  const [agent] = Object.values(configOf(runtime, demoId).agents);
  return agent;
}

// The class and the URL of an HttpAgent.
function classAndUrl(agent: AbstractAgent) {
  if (!(agent instanceof HttpAgent)) {
    throw new Error(`${agent.constructor.name} is not an HttpAgent.`);
  }
  return { agentClass: agent.constructor, url: agent.url };
}

function toolCallTo(id: string): ToolCall {
  return {
    id,
    type: "function",
    function: { name: "lookup", arguments: "{}" },
  };
}

// The events of one tool call, with one TOOL_CALL_ARGS event per delta.
function toolCallEvents(
  toolCallId: string,
  toolCallName: string,
  deltas: string[],
) {
  const args = deltas.map(
    (delta): AgUiEvent => ({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta,
    }),
  );
  const events: AgUiEvent[] = [
    { type: EventType.TOOL_CALL_START, toolCallId, toolCallName },
    ...args,
    { type: EventType.TOOL_CALL_END, toolCallId },
  ];
  return events;
}

// A run of the agent server: RUN_STARTED, `events`, RUN_FINISHED.
function serverRun(events: AgUiEvent[]) {
  return ({ threadId, runId }: RunAgentInput) => {
    const run: AgUiEvent[] = [
      { type: EventType.RUN_STARTED, threadId, runId },
      ...events,
      { type: EventType.RUN_FINISHED, threadId, runId },
    ];
    return run;
  };
}

interface AgentRequest {
  url: string;
  body: RunAgentInput;
}

// Stubs `fetch` with an agent server that answers each request with the
// events of `respond(body)`, as an SSE stream. Returns the requests it gets.
function fakeAgentServer(respond: (body: RunAgentInput) => AgUiEvent[]) {
  const requests: AgentRequest[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body: RunAgentInput = JSON.parse(String(init.body));
    requests.push({ url, body });
    const frames = respond(body).map(
      (event) => `data: ${JSON.stringify(event)}\n\n`,
    );
    return new Response(frames.join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  });
  return requests;
}

interface Run {
  messages?: Message[];
  state?: Record<string, unknown>;
  context?: Context[];
}

// Runs a clone of `agent` as the runtime runs each request, and returns the
// clone and the events of the run.
async function runClone(agent: AbstractAgent, run: Run) {
  const clone: AbstractAgent = agent.clone();
  clone.messages = run.messages ?? [];
  clone.state = run.state ?? {};
  const events: BaseEvent[] = [];
  await clone.runAgent(
    { runId: randomUUID(), context: run.context ?? [] },
    {
      onEvent: ({ event }) => {
        events.push(event);
      },
    },
  );
  return { clone, events };
}

// The only request that the agent server got.
function onlyRequest(requests: AgentRequest[]) {
  expect(requests).toHaveLength(1);
  return requests[0];
}

function snapshotsIn(events: BaseEvent[]) {
  return events
    .filter((event) => event.type === EventType.STATE_SNAPSHOT)
    .map((event) => event.snapshot);
}

const EARLIER_RUN = "0f9e8d7c-6b5a-4321-8fed-cba987654321";
const CK_TAGGED_CALL = `call-1__ck_run_${EARLIER_RUN}`;
const OGUI_TAGGED_CALL = `ui-1__ogui_run_${EARLIER_RUN}`;

// The run that probe() gives each agent: a thread with tagged tool call ids
// and a reasoning message, preferences in state, and one context entry.
const PROBE_RUN: Run = {
  messages: [
    { id: "user-1", role: "user", content: "Hi" },
    { id: "reasoning-1", role: "reasoning", content: "Thinking it over" },
    {
      id: "assistant-1",
      role: "assistant",
      toolCalls: [toolCallTo(CK_TAGGED_CALL), toolCallTo(OGUI_TAGGED_CALL)],
    },
    { id: "tool-1", role: "tool", toolCallId: CK_TAGGED_CALL, content: "done" },
    {
      id: "tool-2",
      role: "tool",
      toolCallId: OGUI_TAGGED_CALL,
      content: "done",
    },
  ],
  state: { preferences: { name: "Ada" } },
  context: [{ description: "Theme", value: "dark" }],
};

const CK_TAGGED_TOOLS = [
  "generate_task_steps",
  "schedule_meeting",
  "request_user_approval",
  "book_call",
];

// The agent server's answer to the probe: one call to each tool that an agent
// handles, with whole arguments.
const PROBE_SERVER_RUN = serverRun([
  ...toolCallEvents("steps-1", "set_steps", ['{"steps":["plan"]}']),
  ...toolCallEvents("doc-1", "write_document", ['{"document":"Hello"}']),
  ...[...CK_TAGGED_TOOLS, "generateSandboxedUi"].flatMap((tool) =>
    toolCallEvents(`${tool}-1`, tool, ["{}"]),
  ),
]);

const APP_CONTEXT_MESSAGE = "## Context from the application\n\nTheme\ndark";
const PREFERENCES_BLOCK = [
  "[shared-state-read-write] preferences:",
  "{",
  '  "name": "Ada",',
  '  "tone": "casual",',
  '  "language": "English",',
  '  "interests": []',
  "}",
].join("\n");
const REASONING_TEXT =
  "I am checking the request, choosing the relevant tool or answer path, and then summarizing the result.";

// The effects (see RouteAgent) that a run shows, sorted.
function effectsIn(request: AgentRequest, events: BaseEvent[]) {
  const sent = request.body.messages;
  const sentToolCallIds = sent.flatMap((message) =>
    message.role === "tool" ? [message.toolCallId] : [],
  );
  const [first] = sent;
  const systemText = first?.role === "system" ? first.content : "";
  const startedCalls = new Map(
    events
      .filter((event) => event.type === EventType.TOOL_CALL_START)
      .map((event) => [event.toolCallName, event.toolCallId]),
  );
  const snapshots = snapshotsIn(events);
  const hasSnapshot = (state: Record<string, unknown>) =>
    snapshots.some((snapshot) => isDeepStrictEqual(snapshot, state));
  const runId = request.body.runId;

  const tagEffects = CK_TAGGED_TOOLS.map((tool): [string, boolean] => [
    `tag ${tool}`,
    startedCalls.get(tool) === `${tool}-1__ck_run_${runId}`,
  ]);
  const effects = {
    ...Object.fromEntries(tagEffects),
    untag: sentToolCallIds.includes("call-1"),
    "untag-ogui": sentToolCallIds.includes("ui-1"),
    "tag-ogui generateSandboxedUi":
      startedCalls.get("generateSandboxedUi") ===
      `generateSandboxedUi-1__ogui_run_${runId}`,
    steps: !startedCalls.has("set_steps") && hasSnapshot({ steps: ["plan"] }),
    document:
      !startedCalls.has("write_document") && hasSnapshot({ document: "Hello" }),
    "app-context": systemText === APP_CONTEXT_MESSAGE,
    preferences: systemText.includes(PREFERENCES_BLOCK),
    reasoning: events.some(
      (event) =>
        event.type === EventType.REASONING_MESSAGE_CONTENT &&
        event.delta === REASONING_TEXT,
    ),
    "no-reasoning-input": !sent.some((message) => message.role === "reasoning"),
  };
  return Object.entries(effects)
    .filter(([, isShown]) => isShown)
    .map(([effect]) => effect)
    .sort();
}

// Runs a clone of `agent` on the probe run. Returns the clone, the URL that
// it posted to, and the effects that the run shows.
async function probe(agent: AbstractAgent) {
  const requests = fakeAgentServer(PROBE_SERVER_RUN);
  const { clone, events } = await runClone(agent, PROBE_RUN);
  const request = onlyRequest(requests);
  return { clone, url: request.url, effects: effectsIn(request, events) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(INTEGRATIONS)("$slug", ({ slug, runtime, env, variable }) => {
  const demoIds = servedDemoIds(slug);

  beforeEach(() => {
    vi.stubEnv(variable, AGENT_SERVER);
  });

  it("has one address variable, the agent server's port 8000", () => {
    expect(env).toEqual({ [variable]: { port: 8000 } });
  });

  it("serves only demos that have a route agent", () => {
    expect(demoIds.filter((id) => ROUTE_AGENTS[id] === undefined)).toEqual([]);
  });

  it.each(demoIds)(
    "%s registers the page's agent ids, at the route's class and URL",
    (demoId) => {
      const { agentClass, path, optionKeys } = routeAgent(demoId);
      const config = configOf(runtime, demoId);

      const agents = Object.entries(config.agents).map(([id, agent]) => ({
        id,
        ...classAndUrl(agent),
      }));

      const expected = (DEMO_AGENT_IDS[demoId] ?? []).map((id) => ({
        id,
        agentClass,
        url: `${AGENT_SERVER}${path}`,
      }));
      expect(agents).toEqual(expected);
      expect(Object.keys(config.options ?? {})).toEqual(optionKeys);
    },
  );

  // The runtime clones each agent for every request.
  it.each(demoIds)(
    "%s: a clone of the agent keeps the route's class, URL and effects",
    async (demoId) => {
      const { agentClass, path, effects } = routeAgent(demoId);

      const run = await probe(agentOf(runtime, demoId));

      expect(classAndUrl(run.clone)).toEqual({
        agentClass,
        url: `${AGENT_SERVER}${path}`,
      });
      expect(run.url).toBe(`${AGENT_SERVER}${path}`);
      expect(run.effects).toEqual([...effects].sort());
    },
  );

  it("returns undefined for every other demo", () => {
    const otherIds = [...Object.keys(DEMO_AGENT_IDS), "no-such-demo"].filter(
      (id) => !demoIds.includes(id),
    );

    const configured = otherIds.filter(
      (id) => runtime.createRuntimeConfig(id) !== undefined,
    );

    expect(otherIds.length).toBeGreaterThan(0);
    expect(configured).toEqual([]);
  });

  it("turns voice transcription off without OPENAI_TRANSCRIPTION_API_KEY", () => {
    vi.stubEnv("OPENAI_TRANSCRIPTION_API_KEY", undefined);

    // An own key set to undefined replaces the voice route's default service.
    expect(configOf(runtime, "voice").options).toStrictEqual({
      transcriptionService: undefined,
    });
  });

  it("transcribes voice with OpenAI given OPENAI_TRANSCRIPTION_API_KEY", () => {
    vi.stubEnv("OPENAI_TRANSCRIPTION_API_KEY", "sk-test");

    const options = configOf(runtime, "voice").options;

    expect(options?.transcriptionService).toBeInstanceOf(
      TranscriptionServiceOpenAI,
    );
  });
});

describe("a replay-safe agent", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_URL_MS_AGENT_DOTNET", AGENT_SERVER);
  });

  // The messages that the hitl-in-chat agent sends for a thread.
  async function sentMessages(messages: Message[]) {
    const requests = fakeAgentServer(serverRun([]));
    await runClone(agentOf(msAgentDotnet, "hitl-in-chat"), { messages });
    return onlyRequest(requests).body.messages;
  }

  it.each([
    ['{"approved":true}', "approved"],
    ['{"accepted":false}', "rejected"],
    ['{"cancelled":true}', "cancelled"],
    ["Cancelled, the call was not booked.", "cancelled"],
  ])(
    "adds the decision in the result %s to the call's id",
    async (content, decision) => {
      const sent = await sentMessages([
        { id: "user-1", role: "user", content: "Book a call" },
        {
          id: "assistant-1",
          role: "assistant",
          toolCalls: [toolCallTo(CK_TAGGED_CALL)],
        },
        { id: "tool-1", role: "tool", toolCallId: CK_TAGGED_CALL, content },
      ]);

      expect(sent).toEqual([
        { id: "user-1", role: "user", content: "Book a call" },
        {
          id: "assistant-1",
          role: "assistant",
          toolCalls: [toolCallTo(`call-1__${decision}`)],
        },
        {
          id: "tool-1",
          role: "tool",
          toolCallId: `call-1__${decision}`,
          content,
        },
      ]);
    },
  );

  it("drops the earlier tool calls once the user writes again", async () => {
    const sent = await sentMessages([
      { id: "user-1", role: "user", content: "Book a call" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Pick a time.",
        toolCalls: [toolCallTo("call-1")],
      },
      { id: "tool-1", role: "tool", toolCallId: "call-1", content: "done" },
      {
        id: "assistant-2",
        role: "assistant",
        toolCalls: [toolCallTo("call-2")],
      },
      { id: "user-2", role: "user", content: "Never mind" },
    ]);

    expect(sent).toEqual([
      { id: "user-1", role: "user", content: "Book a call" },
      { id: "assistant-1", role: "assistant", content: "Pick a time." },
      { id: "user-2", role: "user", content: "Never mind" },
    ]);
  });
});

describe("the shared-state-streaming agent", () => {
  it("puts the document in state as each argument delta arrives", async () => {
    vi.stubEnv("AGENT_URL_MS_AGENT_DOTNET", AGENT_SERVER);
    // The deltas cut a \u escape and a \n escape in two.
    const deltas = ['{"document":"Caf', "\\u00", "e9 \\", "n", 'ok"}'];
    fakeAgentServer(
      serverRun(toolCallEvents("doc-1", "write_document", deltas)),
    );

    const { events } = await runClone(
      agentOf(msAgentDotnet, "shared-state-streaming"),
      {},
    );

    expect(snapshotsIn(events)).toEqual([
      { document: "Caf" },
      { document: "Café " },
      { document: "Café \n" },
      { document: "Café \nok" },
    ]);
  });
});
