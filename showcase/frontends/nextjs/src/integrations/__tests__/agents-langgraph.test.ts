import type { AbstractAgent } from "@ag-ui/client";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import langgraphFastapiAgents from "@/integrations/langgraph-fastapi/agents";
import langgraphFastapiEnv from "@/integrations/langgraph-fastapi/env";
import langgraphPythonAgents from "@/integrations/langgraph-python/agents";
import langgraphPythonEnv from "@/integrations/langgraph-python/env";
import langgraphTypescriptAgents from "@/integrations/langgraph-typescript/agents";
import langgraphTypescriptEnv from "@/integrations/langgraph-typescript/env";
import type {
  IntegrationEnv,
  IntegrationRuntime,
  RuntimeOptions,
} from "@/lib/agents";
import { getIntegration } from "@/lib/registry";

// The expected values come from the route files of each integration's own
// app, under showcase/integrations/<slug>/src/app/api.

// The graph that each langgraph-python demo runs.
const PYTHON_GRAPHS: Record<string, string> = {
  "a2ui-fixed-schema": "a2ui_fixed",
  "a2ui-recovery": "a2ui_recovery",
  "agent-config": "agent_config_agent",
  "agentic-chat": "agentic_chat",
  auth: "sample_agent",
  "beautiful-chat": "beautiful_chat",
  "chat-customization-css": "sample_agent",
  "chat-slots": "sample_agent",
  "declarative-gen-ui": "a2ui_dynamic",
  "declarative-hashbrown": "byoc_hashbrown",
  "declarative-json-render": "byoc_json_render",
  "frontend-tools": "frontend_tools",
  "frontend-tools-async": "frontend_tools_async",
  "gen-ui-agent": "gen_ui_agent",
  "gen-ui-interrupt": "interrupt_agent",
  "gen-ui-tool-based": "gen_ui_tool_based",
  "headless-complete": "headless_complete",
  "headless-simple": "sample_agent",
  hitl: "sample_agent",
  "hitl-in-app": "hitl_in_app",
  "hitl-in-chat": "hitl_in_chat",
  "interrupt-headless": "interrupt_agent",
  "mcp-apps": "mcp_apps",
  multimodal: "multimodal",
  "open-gen-ui": "open_gen_ui",
  "open-gen-ui-advanced": "open_gen_ui_advanced",
  "prebuilt-popup": "sample_agent",
  "prebuilt-sidebar": "sample_agent",
  "readonly-state-agent-context": "readonly_state_agent_context",
  "reasoning-custom": "reasoning_agent",
  "reasoning-default": "reasoning_agent",
  "shared-state-read": "sample_agent",
  "shared-state-read-write": "shared_state_read_write",
  "shared-state-streaming": "shared_state_streaming",
  subagents: "subagents",
  "threadid-frontend-tool-roundtrip": "frontend_tools",
  "tool-rendering": "tool_rendering",
  "tool-rendering-custom-catchall": "tool_rendering",
  "tool-rendering-default-catchall": "tool_rendering",
  "tool-rendering-reasoning-chain": "tool_rendering_reasoning_chain",
  voice: "sample_agent",
};

// langgraph-typescript names its neutral graph starterAgent, and two of its
// graphs have other names.
const TYPESCRIPT_GRAPHS: Record<string, string> = {
  ...PYTHON_GRAPHS,
  "agentic-chat": "starterAgent",
  auth: "starterAgent",
  "chat-customization-css": "starterAgent",
  "chat-slots": "starterAgent",
  "headless-simple": "starterAgent",
  hitl: "starterAgent",
  "prebuilt-popup": "starterAgent",
  "prebuilt-sidebar": "starterAgent",
  "reasoning-custom": "agentic-chat-reasoning",
  "reasoning-default": "agentic-chat-reasoning",
  "shared-state-read": "starterAgent",
  "tool-rendering-reasoning-chain": "tool-rendering-reasoning-chain",
  voice: "starterAgent",
};

// langgraph-fastapi has a graph of its own for the hitl demo.
const FASTAPI_GRAPHS: Record<string, string> = {
  ...PYTHON_GRAPHS,
  hitl: "hitl_steps",
};

// The demos whose pages use the /api/copilotkit route of the integration's
// app. On langgraph-python and langgraph-fastapi, that route runs each graph
// with a recursion limit of 100. The other demos have routes of their own,
// which set no assistant config.
const COPILOTKIT_ROUTE_DEMOS: ReadonlySet<string> = new Set([
  "agentic-chat",
  "chat-customization-css",
  "chat-slots",
  "frontend-tools",
  "frontend-tools-async",
  "gen-ui-agent",
  "gen-ui-interrupt",
  "gen-ui-tool-based",
  "headless-simple",
  "hitl",
  "hitl-in-app",
  "hitl-in-chat",
  "interrupt-headless",
  "prebuilt-popup",
  "prebuilt-sidebar",
  "readonly-state-agent-context",
  "reasoning-custom",
  "reasoning-default",
  "shared-state-read",
  "shared-state-read-write",
  "shared-state-streaming",
  "subagents",
  "threadid-frontend-tool-roundtrip",
  "tool-rendering",
  "tool-rendering-custom-catchall",
  "tool-rendering-default-catchall",
  "tool-rendering-reasoning-chain",
]);

const NO_DEMOS: ReadonlySet<string> = new Set();

// beautiful-chat with the generate_a2ui tool added by the runtime.
const A2UI_WITH_TOOL = {
  a2ui: {
    injectA2UITool: true,
    defaultCatalogId: "copilotkit://app-dashboard-catalog",
  },
};

// declarative-gen-ui with no runtime A2UI settings.
const NO_A2UI = { a2ui: undefined };

/** One integration and what its agents.ts and env.ts must give. */
interface LangGraphCase {
  slug: string;
  runtime: IntegrationRuntime;
  env: IntegrationEnv;
  /** The one address variable. */
  variable: string;
  /**
   * The fake address in the variable. Some of the integration's routes add
   * a trailing slash. The LangGraph client removes it, so both forms reach
   * the same server.
   */
  address: string;
  graphs: Record<string, string>;
  /** The demos whose graphs run with a recursion limit of 100. */
  recursionLimitDemos: ReadonlySet<string>;
  /** The options that replace DEMO_RUNTIME_OPTIONS, by demo id. */
  options: Partial<Record<string, RuntimeOptions>>;
}

const CASES: LangGraphCase[] = [
  {
    slug: "langgraph-python",
    runtime: langgraphPythonAgents,
    env: langgraphPythonEnv,
    variable: "AGENT_URL_LANGGRAPH_PYTHON",
    address: "http://langgraph-python.test:8123",
    graphs: PYTHON_GRAPHS,
    recursionLimitDemos: COPILOTKIT_ROUTE_DEMOS,
    options: {
      "beautiful-chat": A2UI_WITH_TOOL,
      "declarative-gen-ui": NO_A2UI,
      // No transcription without OPENAI_TRANSCRIPTION_API_KEY, which these
      // tests leave unset.
      voice: { transcriptionService: undefined },
    },
  },
  {
    slug: "langgraph-typescript",
    runtime: langgraphTypescriptAgents,
    env: langgraphTypescriptEnv,
    variable: "AGENT_URL_LANGGRAPH_TYPESCRIPT",
    address: "http://langgraph-typescript.test:8123",
    graphs: TYPESCRIPT_GRAPHS,
    recursionLimitDemos: NO_DEMOS,
    options: {
      "beautiful-chat": A2UI_WITH_TOOL,
      "declarative-gen-ui": NO_A2UI,
    },
  },
  {
    slug: "langgraph-fastapi",
    runtime: langgraphFastapiAgents,
    env: langgraphFastapiEnv,
    variable: "AGENT_URL_LANGGRAPH_FASTAPI",
    address: "http://langgraph-fastapi.test:8123",
    graphs: FASTAPI_GRAPHS,
    recursionLimitDemos: COPILOTKIT_ROUTE_DEMOS,
    options: { "declarative-gen-ui": NO_A2UI },
  },
];

// Each integration reads its own variable. Distinct addresses catch an agent
// that reads another integration's variable.
beforeEach(() => {
  for (const { variable, address } of CASES) vi.stubEnv(variable, address);
  vi.stubEnv("OPENAI_TRANSCRIPTION_API_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Every demo that the integration serves: the demos of its manifest, then
// its extra demos.
function demoIdsOf(slug: string) {
  const integration = getIntegration(slug);
  if (integration === undefined) throw new Error(`No manifest has ${slug}.`);
  return integration.demos.map((demo) => demo.id);
}

// What the tests compare for an agent: its graph, address and assistant
// config, or the class of an agent that is not a LangGraphAgent.
function graphOf(agent: AbstractAgent) {
  if (!(agent instanceof LangGraphAgent)) {
    return { unexpectedClass: agent.constructor.name };
  }
  return {
    graphId: agent.graphId,
    deploymentUrl: agent.config.deploymentUrl,
    assistantConfig: agent.assistantConfig,
  };
}

// graphOf of each agent, by agent id.
function graphsOf(agents: Record<string, AbstractAgent>) {
  const entries = Object.entries(agents);
  const graphs: Record<string, ReturnType<typeof graphOf>> = {};
  for (const [agentId, agent] of entries) graphs[agentId] = graphOf(agent);
  return graphs;
}

// The copy of each agent that the runtime makes for every request.
function clonesOf(agents: Record<string, AbstractAgent>) {
  const entries = Object.entries(agents);
  const clones: Record<string, AbstractAgent> = {};
  for (const [agentId, agent] of entries) clones[agentId] = agent.clone();
  return clones;
}

// The expected graphOf for each agent id of the demo's page.
function expectedGraphs(testCase: LangGraphCase, demoId: string) {
  const assistantConfig = testCase.recursionLimitDemos.has(demoId)
    ? { recursion_limit: 100 }
    : undefined;
  const graph = {
    graphId: testCase.graphs[demoId],
    deploymentUrl: testCase.address,
    assistantConfig,
  };
  const agentIds = DEMO_AGENT_IDS[demoId];
  if (agentIds === undefined) throw new Error(`No agent ids for ${demoId}.`);
  return Object.fromEntries(agentIds.map((agentId) => [agentId, graph]));
}

// The agents of a demo. A demo without a runtime config has none.
function agentsOf(testCase: LangGraphCase, demoId: string) {
  return testCase.runtime.createRuntimeConfig(demoId)?.agents ?? {};
}

describe.each(CASES)("$slug", (testCase) => {
  const demoIds = demoIdsOf(testCase.slug);

  it("points its address variable at the LangGraph server's port", () => {
    expect(testCase.env).toStrictEqual({ [testCase.variable]: { port: 8123 } });
  });

  it.each(demoIds)(
    "gives each agent id of the %s page its graph on the server",
    (demoId) => {
      expect(graphsOf(agentsOf(testCase, demoId))).toStrictEqual(
        expectedGraphs(testCase, demoId),
      );
    },
  );

  it("keeps the graph, address and assistant config in each request's clone", () => {
    const agents = agentsOf(testCase, "agentic-chat");

    expect(graphsOf(clonesOf(agents))).toStrictEqual(
      expectedGraphs(testCase, "agentic-chat"),
    );
  });

  it("replaces the default runtime options only where its routes differ", () => {
    const options: Partial<Record<string, RuntimeOptions>> = {};
    for (const demoId of demoIds) {
      const demoOptions = testCase.runtime.createRuntimeConfig(demoId)?.options;
      if (demoOptions !== undefined) options[demoId] = demoOptions;
    }

    expect(options).toStrictEqual(testCase.options);
  });

  it("returns undefined for a demo that it does not serve", () => {
    expect(
      testCase.runtime.createRuntimeConfig("background-agents"),
    ).toBeUndefined();
  });
});

describe("langgraph-python voice", () => {
  it("transcribes with OpenAI when OPENAI_TRANSCRIPTION_API_KEY is set", () => {
    vi.stubEnv("OPENAI_TRANSCRIPTION_API_KEY", "transcription-key");
    const runtime: IntegrationRuntime = langgraphPythonAgents;

    const options = runtime.createRuntimeConfig("voice")?.options;

    expect(options?.transcriptionService).toBeInstanceOf(
      TranscriptionServiceOpenAI,
    );
  });
});
