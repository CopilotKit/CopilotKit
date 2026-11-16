import { EventType, HttpAgent } from "@ag-ui/client";
import type {
  AbstractAgent,
  RunAgentInput,
  RunAgentParameters,
} from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { DEMO_RUNTIME_OPTIONS } from "@/demo-runtime-options";
import ag2Agents from "@/integrations/ag2/agents";
import ag2Env from "@/integrations/ag2/env";
import claudeSdkPythonAgents from "@/integrations/claude-sdk-python/agents";
import claudeSdkPythonEnv from "@/integrations/claude-sdk-python/env";
import langroidAgents from "@/integrations/langroid/agents";
import langroidEnv from "@/integrations/langroid/env";
import llamaindexAgents from "@/integrations/llamaindex/agents";
import llamaindexEnv from "@/integrations/llamaindex/env";
import pydanticAiAgents from "@/integrations/pydantic-ai/agents";
import pydanticAiEnv from "@/integrations/pydantic-ai/env";
import { AgentConfigHttpAgent } from "@/lib/agent-config-http-agent";
import type {
  IntegrationEnv,
  IntegrationRuntime,
  RuntimeOptions,
} from "@/lib/agents";
import { getIntegration } from "@/lib/registry";

// The expected values come from each integration's own app: the route files
// under showcase/integrations/<slug>/src/app/api, and the agent port in its
// entrypoint.sh. The demos come from the real registry.

/** What one integration's routes do today. */
interface TodaysRoutes {
  slug: string;
  /** The variable that holds the agent server's address. */
  variable: string;
  env: IntegrationEnv;
  runtime: IntegrationRuntime;
  /** The demos whose agent is at each path of the agent server. */
  paths: Record<string, string[]>;
  /** The runtime options of each demo that has options. */
  options: Partial<Record<string, RuntimeOptions>>;
}

// Where an integration's agent server answers in these tests.
function agentServer(slug: string) {
  return `http://${slug}:8000`;
}

const APP_DASHBOARD_CATALOG = "copilotkit://app-dashboard-catalog";
const DECLARATIVE_CATALOG = "declarative-gen-ui-catalog";

const OPEN_GEN_UI = {
  openGenerativeUI: { agents: ["open-gen-ui", "open-gen-ui-advanced"] },
} satisfies RuntimeOptions;

// MCP_SERVER_URL is not set in these tests.
const EXCALIDRAW_MCP_APPS = {
  mcpApps: {
    servers: [
      {
        type: "http",
        url: "https://mcp.excalidraw.com/mcp",
        serverId: "excalidraw",
      },
    ],
  },
} satisfies RuntimeOptions;

const AG2_DIAGRAM_MCP_APPS = {
  mcpApps: {
    servers: [
      {
        type: "http",
        url: "http://ag2:8000/mcp-apps-server/mcp/",
        serverId: "ag2-diagram",
      },
    ],
  },
} satisfies RuntimeOptions;

const AG2: TodaysRoutes = {
  slug: "ag2",
  variable: "AGENT_URL_AG2",
  env: ag2Env,
  runtime: ag2Agents,
  paths: {
    "/": [
      "agentic-chat",
      "auth",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-tool-based",
      "headless-simple",
      "hitl",
      "hitl-in-app",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "shared-state-read",
      "shared-state-streaming",
      "threadid-frontend-tool-roundtrip",
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
      "voice",
    ],
    "/a2ui-fixed-schema/": ["a2ui-fixed-schema"],
    "/agent-config/": ["agent-config"],
    "/beautiful-chat/": ["beautiful-chat"],
    "/byoc-hashbrown/": ["declarative-hashbrown"],
    "/byoc-json-render/": ["declarative-json-render"],
    "/declarative-gen-ui/": ["declarative-gen-ui"],
    "/gen-ui-agent/": ["gen-ui-agent"],
    "/headless-complete/": ["headless-complete"],
    "/hitl-in-chat/": ["hitl-in-chat"],
    "/interrupt-adapted/": ["gen-ui-interrupt", "interrupt-headless"],
    "/mcp-apps/": ["mcp-apps"],
    "/multimodal/": ["multimodal"],
    "/open-gen-ui/": ["open-gen-ui"],
    "/open-gen-ui-advanced/": ["open-gen-ui-advanced"],
    "/reasoning/": ["reasoning-custom", "reasoning-default"],
    "/shared-state-read-write/": ["shared-state-read-write"],
    "/subagents/": ["subagents"],
    "/tool-rendering-reasoning-chain/": ["tool-rendering-reasoning-chain"],
  },
  options: {
    "a2ui-fixed-schema": { a2ui: { injectA2UITool: false } },
    "beautiful-chat": {
      a2ui: { injectA2UITool: false, defaultCatalogId: APP_DASHBOARD_CATALOG },
      openGenerativeUI: { agents: ["beautiful-chat"] },
    },
    "declarative-gen-ui": { a2ui: { defaultCatalogId: DECLARATIVE_CATALOG } },
    "headless-complete": AG2_DIAGRAM_MCP_APPS,
    "mcp-apps": AG2_DIAGRAM_MCP_APPS,
    "open-gen-ui": OPEN_GEN_UI,
    "open-gen-ui-advanced": OPEN_GEN_UI,
  },
};

const CLAUDE_SDK_PYTHON: TodaysRoutes = {
  slug: "claude-sdk-python",
  variable: "AGENT_URL_CLAUDE_SDK_PYTHON",
  env: claudeSdkPythonEnv,
  runtime: claudeSdkPythonAgents,
  paths: {
    "/": [
      "agentic-chat",
      "auth",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-tool-based",
      "headless-simple",
      "hitl",
      "hitl-in-app",
      "open-gen-ui",
      "open-gen-ui-advanced",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "shared-state-read",
      "threadid-frontend-tool-roundtrip",
      "voice",
    ],
    "/a2ui-fixed-schema": ["a2ui-fixed-schema"],
    "/agent-config": ["agent-config"],
    "/beautiful-chat": ["beautiful-chat"],
    "/declarative-gen-ui": ["declarative-gen-ui"],
    "/declarative-hashbrown": ["declarative-hashbrown"],
    "/declarative-json-render": ["declarative-json-render"],
    "/gen-ui-agent": ["gen-ui-agent"],
    "/headless-complete": ["headless-complete"],
    "/hitl-in-chat": ["hitl-in-chat"],
    "/interrupt-adapted": ["gen-ui-interrupt", "interrupt-headless"],
    "/mcp-apps": ["mcp-apps"],
    "/multimodal": ["multimodal"],
    "/reasoning": ["reasoning-custom", "reasoning-default"],
    "/shared-state-read-write": ["shared-state-read-write"],
    "/shared-state-streaming": ["shared-state-streaming"],
    "/subagents": ["subagents"],
    "/tool-rendering": [
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
    ],
    "/tool-rendering-reasoning-chain": ["tool-rendering-reasoning-chain"],
  },
  options: {
    "a2ui-fixed-schema": { a2ui: { injectA2UITool: false } },
    "beautiful-chat": {
      openGenerativeUI: true,
      a2ui: { injectA2UITool: false, defaultCatalogId: APP_DASHBOARD_CATALOG },
      ...EXCALIDRAW_MCP_APPS,
    },
    "declarative-gen-ui": {
      a2ui: { injectA2UITool: false, defaultCatalogId: DECLARATIVE_CATALOG },
    },
    "headless-complete": EXCALIDRAW_MCP_APPS,
    "mcp-apps": EXCALIDRAW_MCP_APPS,
    "open-gen-ui": OPEN_GEN_UI,
    "open-gen-ui-advanced": OPEN_GEN_UI,
  },
};

const LANGROID: TodaysRoutes = {
  slug: "langroid",
  variable: "AGENT_URL_LANGROID",
  env: langroidEnv,
  runtime: langroidAgents,
  paths: {
    "/": [
      "agent-config",
      "agentic-chat",
      "auth",
      "beautiful-chat",
      "chat-customization-css",
      "chat-slots",
      "declarative-gen-ui",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-interrupt",
      "gen-ui-tool-based",
      "headless-complete",
      "headless-simple",
      "hitl",
      "hitl-in-app",
      "hitl-in-chat",
      "interrupt-headless",
      "open-gen-ui",
      "open-gen-ui-advanced",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "shared-state-read",
      "shared-state-streaming",
      "threadid-frontend-tool-roundtrip",
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
      "voice",
    ],
    "/a2ui-fixed-schema": ["a2ui-fixed-schema"],
    "/byoc-hashbrown": ["declarative-hashbrown"],
    "/byoc-json-render": ["declarative-json-render"],
    "/gen-ui-agent": ["gen-ui-agent"],
    "/mcp-apps": ["mcp-apps"],
    "/multimodal": ["multimodal"],
    "/reasoning/": ["reasoning-custom", "reasoning-default"],
    "/reasoning/tools/": ["tool-rendering-reasoning-chain"],
    // From the routes /api/copilotkit-shared-state-read-write and
    // /api/copilotkit-subagents. Today's pages post to /api/copilotkit, which
    // sends both to "/", an agent that keeps no state.
    "/shared-state-read-write": ["shared-state-read-write"],
    "/subagents": ["subagents"],
  },
  options: {
    "a2ui-fixed-schema": { a2ui: { injectA2UITool: false } },
    "beautiful-chat": {
      openGenerativeUI: true,
      a2ui: { injectA2UITool: false, defaultCatalogId: APP_DASHBOARD_CATALOG },
    },
    "declarative-gen-ui": { a2ui: { defaultCatalogId: DECLARATIVE_CATALOG } },
    "headless-complete": EXCALIDRAW_MCP_APPS,
    "mcp-apps": EXCALIDRAW_MCP_APPS,
    "open-gen-ui": OPEN_GEN_UI,
    "open-gen-ui-advanced": OPEN_GEN_UI,
  },
};

const LLAMAINDEX: TodaysRoutes = {
  slug: "llamaindex",
  variable: "AGENT_URL_LLAMAINDEX",
  env: llamaindexEnv,
  runtime: llamaindexAgents,
  paths: {
    "/run": [
      "agentic-chat",
      "auth",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "headless-complete",
      "headless-simple",
      "hitl",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "shared-state-read",
      "shared-state-streaming",
      "threadid-frontend-tool-roundtrip",
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
    ],
    "/a2ui-dynamic/run": ["declarative-gen-ui"],
    "/a2ui-fixed/run": ["a2ui-fixed-schema"],
    "/agent-config/run": ["agent-config"],
    "/beautiful-chat/run": ["beautiful-chat"],
    "/byoc-hashbrown/run": ["declarative-hashbrown"],
    "/byoc-json-render/run": ["declarative-json-render"],
    "/frontend-tools-async/run": ["frontend-tools-async"],
    "/gen-ui-agent/run": ["gen-ui-agent"],
    "/gen-ui-tool-based/run": ["gen-ui-tool-based"],
    "/hitl-in-app/run": ["hitl-in-app"],
    "/hitl-in-chat/run": ["hitl-in-chat"],
    "/interrupt/run": ["gen-ui-interrupt", "interrupt-headless"],
    "/mcp-apps/run": ["mcp-apps"],
    "/multimodal/run": ["multimodal"],
    "/open-gen-ui/run": ["open-gen-ui"],
    "/open-gen-ui-advanced/run": ["open-gen-ui-advanced"],
    "/reasoning/run": ["reasoning-custom", "reasoning-default"],
    "/shared-state-read-write/run": ["shared-state-read-write"],
    "/subagents/run": ["subagents"],
    "/tool-rendering-reasoning-chain/run": ["tool-rendering-reasoning-chain"],
    "/voice/run": ["voice"],
  },
  options: {
    "a2ui-fixed-schema": { a2ui: { injectA2UITool: true } },
    "beautiful-chat": {
      openGenerativeUI: true,
      a2ui: { injectA2UITool: true, defaultCatalogId: APP_DASHBOARD_CATALOG },
    },
    "declarative-gen-ui": {
      a2ui: { injectA2UITool: true, defaultCatalogId: DECLARATIVE_CATALOG },
    },
    "headless-complete": EXCALIDRAW_MCP_APPS,
    "mcp-apps": EXCALIDRAW_MCP_APPS,
    "open-gen-ui": OPEN_GEN_UI,
    "open-gen-ui-advanced": OPEN_GEN_UI,
  },
};

const PYDANTIC_AI: TodaysRoutes = {
  slug: "pydantic-ai",
  variable: "AGENT_URL_PYDANTIC_AI",
  env: pydanticAiEnv,
  runtime: pydanticAiAgents,
  paths: {
    "/": [
      "agentic-chat",
      "auth",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-agent",
      "headless-simple",
      "hitl",
      "hitl-in-app",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "shared-state-read",
      "shared-state-streaming",
      "threadid-frontend-tool-roundtrip",
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
      "voice",
    ],
    "/a2ui_dynamic/": ["declarative-gen-ui"],
    "/a2ui_fixed/": ["a2ui-fixed-schema"],
    "/agent_config/": ["agent-config"],
    "/beautiful_chat/": ["beautiful-chat"],
    "/byoc_hashbrown/": ["declarative-hashbrown"],
    "/byoc_json_render/": ["declarative-json-render"],
    "/gen_ui_tool_based/": ["gen-ui-tool-based"],
    "/headless_complete/": ["headless-complete"],
    "/hitl_in_chat/": ["hitl-in-chat"],
    "/interrupt/": ["gen-ui-interrupt", "interrupt-headless"],
    "/mcp_apps/": ["mcp-apps"],
    "/multimodal/": ["multimodal"],
    "/open_gen_ui/": ["open-gen-ui"],
    "/open_gen_ui_advanced/": ["open-gen-ui-advanced"],
    "/reasoning/": ["reasoning-custom", "reasoning-default"],
    "/shared_state_read_write/": ["shared-state-read-write"],
    "/subagents/": ["subagents"],
    "/tool_rendering_reasoning_chain/": ["tool-rendering-reasoning-chain"],
  },
  options: {
    "a2ui-fixed-schema": { a2ui: { injectA2UITool: false } },
    "beautiful-chat": {
      openGenerativeUI: true,
      a2ui: { injectA2UITool: false, defaultCatalogId: APP_DASHBOARD_CATALOG },
    },
    "declarative-gen-ui": {
      a2ui: { injectA2UITool: false, defaultCatalogId: DECLARATIVE_CATALOG },
    },
    "headless-complete": EXCALIDRAW_MCP_APPS,
    "mcp-apps": EXCALIDRAW_MCP_APPS,
    "open-gen-ui": OPEN_GEN_UI,
    "open-gen-ui-advanced": OPEN_GEN_UI,
  },
};

const INTEGRATIONS = [
  AG2,
  CLAUDE_SDK_PYTHON,
  LANGROID,
  LLAMAINDEX,
  PYDANTIC_AI,
];

// The ids of the demos that the app serves for `slug`, extras included.
function servedDemos(slug: string) {
  return getIntegration(slug)?.demos.map((demo) => demo.id) ?? [];
}

// The expected URL of each demo's agent.
function urlsByDemo({ slug, paths }: TodaysRoutes) {
  const urls = new Map<string, string>();
  const groups = Object.entries(paths);
  for (const [path, demos] of groups) {
    for (const demo of demos) urls.set(demo, `${agentServer(slug)}${path}`);
  }
  return urls;
}

function configOf(runtime: IntegrationRuntime, demo: string) {
  const config = runtime.createRuntimeConfig(demo);
  if (config === undefined) {
    throw new Error(`createRuntimeConfig("${demo}") returned undefined.`);
  }
  return config;
}

function httpAgentOf(agent: AbstractAgent | undefined) {
  if (agent instanceof HttpAgent) return agent;
  throw new Error("Expected an HttpAgent.");
}

// The URL of each agent, by agent id.
function agentUrls(agents: Record<string, AbstractAgent>) {
  const entries = Object.entries(agents);
  return Object.fromEntries(
    entries.map(([id, agent]) => [id, httpAgentOf(agent).url] as const),
  );
}

// Stands in for the agent servers: records each posted run body, and answers
// with a run that starts and finishes.
function stubAgentServers() {
  const bodies: RunAgentInput[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body: RunAgentInput = JSON.parse(String(init.body));
    bodies.push(body);
    const run = { threadId: body.threadId, runId: body.runId };
    const events = [
      { type: EventType.RUN_STARTED, ...run },
      { type: EventType.RUN_FINISHED, ...run },
    ];
    const stream = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
    return new Response(stream.join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  });
  return bodies;
}

// The run body that the agent server receives when `agent` runs.
async function postedBody(
  agent: AbstractAgent,
  parameters: RunAgentParameters,
) {
  const bodies = stubAgentServers();
  await agent.runAgent(parameters);
  expect(bodies).toHaveLength(1);
  return bodies[0];
}

function agentConfigAgent(runtime: IntegrationRuntime) {
  return configOf(runtime, "agent-config").agents["agent-config-demo"];
}

// The URL of the first MCP Apps server in `options`.
function mcpServerUrl(options: RuntimeOptions | undefined) {
  return options?.mcpApps?.servers.at(0)?.url;
}

beforeEach(() => {
  for (const { slug, variable } of INTEGRATIONS) {
    vi.stubEnv(variable, agentServer(slug));
  }
  vi.stubEnv("MCP_SERVER_URL", undefined);
  vi.stubEnv("ANTHROPIC_BASE_URL", undefined);
  vi.stubEnv("AIMOCK_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(INTEGRATIONS)("$slug", (routes) => {
  const { slug, variable, env, runtime, options } = routes;
  const served = servedDemos(slug);
  const urls = urlsByDemo(routes);

  it("points its one address variable at port 8000", () => {
    expect(env).toEqual({ [variable]: { port: 8000 } });
  });

  it("has today's agent path for every demo it serves", () => {
    expect([...urls.keys()].sort()).toEqual([...served].sort());
  });

  // The route adds DEMO_RUNTIME_OPTIONS under the integration's options, as
  // here. The voice route also adds its transcription service.
  it.each(served)(
    "%s: registers the page's agent ids at today's agent, with today's runtime options",
    (demo) => {
      const config = configOf(runtime, demo);
      const agentIds = DEMO_AGENT_IDS[demo] ?? [];

      expect({
        agents: agentUrls(config.agents),
        options: { ...DEMO_RUNTIME_OPTIONS[demo], ...config.options },
      }).toEqual({
        agents: Object.fromEntries(agentIds.map((id) => [id, urls.get(demo)])),
        options: options[demo] ?? {},
      });
    },
  );

  it("returns undefined for every demo it does not serve", () => {
    const otherDemos = [...Object.keys(DEMO_AGENT_IDS), "no-such-demo"].filter(
      (demo) => !served.includes(demo),
    );

    const configured = otherDemos.filter(
      (demo) => runtime.createRuntimeConfig(demo) !== undefined,
    );

    expect(configured).toEqual([]);
  });
});

describe("the agent-config agent", () => {
  it.each([
    ["ag2", ag2Agents],
    ["claude-sdk-python", claudeSdkPythonAgents],
    ["langroid", langroidAgents],
    ["llamaindex", llamaindexAgents],
  ])(
    "of %s is an AgentConfigHttpAgent, and its clone moves the provider's properties into config.configurable",
    async (_, runtime) => {
      const clone = agentConfigAgent(runtime).clone();

      const body = await postedBody(clone, {
        forwardedProps: { tone: "casual" },
      });

      expect(clone).toBeInstanceOf(AgentConfigHttpAgent);
      expect(body.forwardedProps).toEqual({
        config: { configurable: { properties: { tone: "casual" } } },
      });
    },
  );

  it("of pydantic-ai, cloned, moves the provider's properties into a context entry that replaces the earlier one", async () => {
    const clone = agentConfigAgent(pydanticAiAgents).clone();

    const body = await postedBody(clone, {
      forwardedProps: { tone: "casual", streamMode: "values" },
      context: [
        { description: "agent-config-properties", value: '{"tone":"formal"}' },
        { description: "The user's name", value: "Ada" },
      ],
    });

    expect({
      forwardedProps: body.forwardedProps,
      context: body.context,
    }).toEqual({
      forwardedProps: { streamMode: "values" },
      context: [
        { description: "The user's name", value: "Ada" },
        { description: "agent-config-properties", value: '{"tone":"casual"}' },
      ],
    });
  });

  it("of pydantic-ai posts a run without provider properties as it is", async () => {
    const body = await postedBody(agentConfigAgent(pydanticAiAgents), {
      forwardedProps: { streamMode: "values" },
      context: [{ description: "The user's name", value: "Ada" }],
    });

    expect({
      forwardedProps: body.forwardedProps,
      context: body.context,
    }).toEqual({
      forwardedProps: { streamMode: "values" },
      context: [{ description: "The user's name", value: "Ada" }],
    });
  });
});

describe("AgentConfigHttpAgent", () => {
  function agent() {
    return new AgentConfigHttpAgent({ url: "http://agent:8000/agent-config/" });
  }

  it("keeps the run's own keys, and sets each property over the one already in config.configurable", async () => {
    const body = await postedBody(agent(), {
      forwardedProps: {
        tone: "casual",
        expertise: "expert",
        streamMode: "values",
        config: {
          recursion_limit: 5,
          configurable: {
            thread_id: "thread-1",
            properties: { tone: "formal", responseLength: "short" },
          },
        },
      },
    });

    expect(body.forwardedProps).toEqual({
      streamMode: "values",
      config: {
        recursion_limit: 5,
        configurable: {
          thread_id: "thread-1",
          properties: {
            tone: "casual",
            responseLength: "short",
            expertise: "expert",
          },
        },
      },
    });
  });

  it("posts forwardedProps without provider properties as they are", async () => {
    const body = await postedBody(agent(), {
      forwardedProps: { streamMode: "values", config: { recursion_limit: 5 } },
    });

    expect(body.forwardedProps).toEqual({
      streamMode: "values",
      config: { recursion_limit: 5 },
    });
  });
});

describe("ag2's MCP Apps server", () => {
  it("reads AGENT_URL_AG2 each time the runtime asks for its URL", () => {
    const { options } = configOf(ag2Agents, "mcp-apps");

    vi.stubEnv("AGENT_URL_AG2", "http://ag2-moved:8000");

    expect(mcpServerUrl(options)).toBe(
      "http://ag2-moved:8000/mcp-apps-server/mcp/",
    );
  });

  it("is replaced by MCP_SERVER_URL", () => {
    vi.stubEnv("MCP_SERVER_URL", "http://diagrams:3001/mcp");

    const { options } = configOf(ag2Agents, "headless-complete");

    expect(mcpServerUrl(options)).toBe("http://diagrams:3001/mcp");
  });
});

describe("claude-sdk-python's agents", () => {
  const demos = servedDemos("claude-sdk-python");

  function agentHeaders() {
    return demos.flatMap((demo) => {
      const { agents } = configOf(claudeSdkPythonAgents, demo);
      return Object.values(agents).map((agent) => httpAgentOf(agent).headers);
    });
  }

  it.each(["ANTHROPIC_BASE_URL", "AIMOCK_URL"])(
    "send x-aimock-context: claude-sdk-python when %s points at aimock",
    (variable) => {
      vi.stubEnv(variable, "http://aimock:4010");

      expect(agentHeaders()).toEqual(
        demos.map(() => ({ "x-aimock-context": "claude-sdk-python" })),
      );
    },
  );

  it("send no headers of their own when Claude calls go to Anthropic", () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");

    expect(agentHeaders()).toEqual(demos.map(() => ({})));
  });
});
