import { EventType, HttpAgent } from "@ag-ui/client";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
  State,
} from "@ag-ui/client";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { DEMO_RUNTIME_OPTIONS } from "@/demo-runtime-options";
import agnoAgents from "@/integrations/agno/agents";
import agnoEnv from "@/integrations/agno/env";
import claudeSdkTypescriptAgents from "@/integrations/claude-sdk-typescript/agents";
import claudeSdkTypescriptEnv from "@/integrations/claude-sdk-typescript/env";
import crewaiConversationalFlowsAgents from "@/integrations/crewai-conversational-flows/agents";
import crewaiConversationalFlowsEnv from "@/integrations/crewai-conversational-flows/env";
import crewaiCrewsAgents from "@/integrations/crewai-crews/agents";
import crewaiCrewsEnv from "@/integrations/crewai-crews/env";
import googleAdkAgents from "@/integrations/google-adk/agents";
import googleAdkEnv from "@/integrations/google-adk/env";
import googleAntigravityAgents from "@/integrations/google-antigravity/agents";
import googleAntigravityEnv from "@/integrations/google-antigravity/env";
import msAgentPythonAgents from "@/integrations/ms-agent-python/agents";
import msAgentPythonEnv from "@/integrations/ms-agent-python/env";
import openaiAgentsPythonAgents from "@/integrations/openai-agents-python/agents";
import openaiAgentsPythonEnv from "@/integrations/openai-agents-python/env";
import springAiAgents from "@/integrations/spring-ai/agents";
import springAiEnv from "@/integrations/spring-ai/env";
import strandsTypescriptAgents from "@/integrations/strands-typescript/agents";
import strandsTypescriptEnv from "@/integrations/strands-typescript/env";
import strandsAgents from "@/integrations/strands/agents";
import strandsEnv from "@/integrations/strands/env";
import type {
  IntegrationEnv,
  IntegrationRuntime,
  RuntimeOptions,
} from "@/lib/agents";
import { getIntegration } from "@/lib/registry";

// The expected values come from each integration's own app: the route files
// under showcase/integrations/<slug>/src/app/api (for each demo, the route
// that its page calls), and the agent port in its entrypoint.sh. The demos
// come from the real registry.

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
const FLIGHT_CATALOG = "copilotkit://flight-fixed-catalog";

// MCP_SERVER_URL is not set in these tests, so each server is at its default:
// Excalidraw's MCP endpoint, which the MCP Apps middleware needs because it
// refuses the site root's redirect.
const EXCALIDRAW = "https://mcp.excalidraw.com/mcp";

function mcpApps(url: string, serverId: string) {
  return {
    mcpApps: { servers: [{ type: "http", url, serverId }] },
  } satisfies RuntimeOptions;
}

const OPEN_GEN_UI = {
  openGenerativeUI: { agents: ["open-gen-ui", "open-gen-ui-advanced"] },
} satisfies RuntimeOptions;

const BEAUTIFUL_CHAT_WITHOUT_MCP_APPS = {
  openGenerativeUI: true,
  a2ui: { injectA2UITool: false, defaultCatalogId: APP_DASHBOARD_CATALOG },
} satisfies RuntimeOptions;

// The options that most integrations' routes set, by demo id.
const COMMON_OPTIONS = {
  "a2ui-fixed-schema": { a2ui: { injectA2UITool: false } },
  "a2ui-recovery": {
    a2ui: { injectA2UITool: false, defaultCatalogId: DECLARATIVE_CATALOG },
  },
  "beautiful-chat": {
    ...BEAUTIFUL_CHAT_WITHOUT_MCP_APPS,
    ...mcpApps(EXCALIDRAW, "beautiful_chat_mcp"),
  },
  "declarative-gen-ui": {
    a2ui: { injectA2UITool: false, defaultCatalogId: DECLARATIVE_CATALOG },
  },
  "headless-complete": mcpApps(EXCALIDRAW, "excalidraw"),
  "mcp-apps": mcpApps(EXCALIDRAW, "excalidraw"),
  "open-gen-ui": OPEN_GEN_UI,
  "open-gen-ui-advanced": OPEN_GEN_UI,
} satisfies Partial<Record<string, RuntimeOptions>>;

const STRANDS: TodaysRoutes = {
  slug: "strands",
  variable: "AGENT_URL_STRANDS",
  env: strandsEnv,
  runtime: strandsAgents,
  paths: {
    "/": [
      "agent-config",
      "agentic-chat",
      "auth",
      "beautiful-chat",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-agent",
      "gen-ui-tool-based",
      "headless-complete",
      "headless-simple",
      "hitl",
      "hitl-in-app",
      "hitl-in-chat",
      "mcp-apps",
      "multimodal",
      "open-gen-ui",
      "open-gen-ui-advanced",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "shared-state-read",
      "shared-state-read-write",
      "shared-state-streaming",
      "subagents",
      "threadid-frontend-tool-roundtrip",
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
    ],
    "/a2ui-fixed-schema/": ["a2ui-fixed-schema"],
    "/a2ui-recovery/": ["a2ui-recovery"],
    "/byoc-hashbrown/": ["declarative-hashbrown"],
    "/byoc-json-render/": ["declarative-json-render"],
    "/declarative-gen-ui/": ["declarative-gen-ui"],
    "/interrupt/": ["gen-ui-interrupt", "interrupt-headless"],
    "/reasoning/": ["reasoning-custom", "reasoning-default"],
    "/reasoning-chain/": ["tool-rendering-reasoning-chain"],
    "/voice/": ["voice"],
  },
  options: {
    ...COMMON_OPTIONS,
    "a2ui-fixed-schema": {
      a2ui: { injectA2UITool: false, defaultCatalogId: FLIGHT_CATALOG },
    },
    "a2ui-recovery": {},
    "beautiful-chat": BEAUTIFUL_CHAT_WITHOUT_MCP_APPS,
    "declarative-gen-ui": {},
  },
};

// strands-typescript's routes are strands' routes, except that its
// beautiful-chat agent has an endpoint of its own.
const STRANDS_TYPESCRIPT: TodaysRoutes = {
  slug: "strands-typescript",
  variable: "AGENT_URL_STRANDS_TYPESCRIPT",
  env: strandsTypescriptEnv,
  runtime: strandsTypescriptAgents,
  paths: {
    ...STRANDS.paths,
    "/": STRANDS.paths["/"].filter((demo) => demo !== "beautiful-chat"),
    "/beautiful-chat": ["beautiful-chat"],
  },
  options: STRANDS.options,
};

const AGNO: TodaysRoutes = {
  slug: "agno",
  variable: "AGENT_URL_AGNO",
  env: agnoEnv,
  runtime: agnoAgents,
  paths: {
    "/agui": [
      "agentic-chat",
      "auth",
      "beautiful-chat",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-tool-based",
      "headless-complete",
      "headless-simple",
      "hitl",
      "hitl-in-app",
      "hitl-in-chat",
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
    "/a2ui-fixed-schema/agui": ["a2ui-fixed-schema"],
    "/agent-config/agui": ["agent-config"],
    "/byoc-hashbrown/agui": ["declarative-hashbrown"],
    "/byoc-json-render/agui": ["declarative-json-render"],
    "/declarative-gen-ui/agui": ["declarative-gen-ui"],
    "/gen-ui-agent/agui": ["gen-ui-agent"],
    "/interrupt-adapted/agui": ["gen-ui-interrupt", "interrupt-headless"],
    "/mcp-apps/agui": ["mcp-apps"],
    "/multimodal/agui": ["multimodal"],
    "/open-gen-ui/agui": ["open-gen-ui", "open-gen-ui-advanced"],
    "/reasoning/agui": [
      "reasoning-custom",
      "reasoning-default",
      "tool-rendering-reasoning-chain",
    ],
    "/shared-state-rw/agui": ["shared-state-read-write"],
    "/subagents/agui": ["subagents"],
  },
  options: {
    ...COMMON_OPTIONS,
    "beautiful-chat": BEAUTIFUL_CHAT_WITHOUT_MCP_APPS,
  },
};

const CREWAI_CREWS: TodaysRoutes = {
  slug: "crewai-crews",
  variable: "AGENT_URL_CREWAI_CREWS",
  env: crewaiCrewsEnv,
  runtime: crewaiCrewsAgents,
  paths: {
    "/chat": [
      "agent-config",
      "agentic-chat",
      "auth",
      "chat-customization-css",
      "chat-slots",
      "headless-simple",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "threadid-frontend-tool-roundtrip",
      "voice",
    ],
    "/frontend-tools": [
      "frontend-tools",
      "frontend-tools-async",
      "hitl",
      "hitl-in-app",
      "hitl-in-chat",
      "open-gen-ui",
      "open-gen-ui-advanced",
    ],
    "/tool-rendering": [
      "headless-complete",
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
    ],
    "/a2ui-fixed-schema": ["a2ui-fixed-schema"],
    "/a2ui-recovery": ["a2ui-recovery"],
    "/beautiful-chat": ["beautiful-chat"],
    "/byoc-hashbrown": ["byoc-hashbrown", "declarative-hashbrown"],
    "/byoc-json-render": ["declarative-json-render"],
    "/declarative-gen-ui": ["declarative-gen-ui"],
    "/gen-ui-agent": ["gen-ui-agent"],
    "/gen-ui-tool-based": ["gen-ui-tool-based"],
    "/interrupt": ["gen-ui-interrupt", "interrupt-headless"],
    "/mcp-apps": ["mcp-apps"],
    "/multimodal": ["multimodal"],
    "/reasoning": ["reasoning-custom", "reasoning-default"],
    "/shared-state-read": ["shared-state-read"],
    "/shared-state-read-write": ["shared-state-read-write"],
    "/shared-state-streaming": ["shared-state-streaming"],
    "/subagents": ["subagents"],
    "/tool-rendering-reasoning": ["tool-rendering-reasoning-chain"],
  },
  options: {
    ...COMMON_OPTIONS,
    "beautiful-chat": BEAUTIFUL_CHAT_WITHOUT_MCP_APPS,
    "declarative-gen-ui": { a2ui: { defaultCatalogId: DECLARATIVE_CATALOG } },
  },
};

// crewai-conversational-flows mounts the same Flows as crewai-crews, under
// /conversational_flows.
const CREWAI_CONVERSATIONAL_FLOWS: TodaysRoutes = {
  slug: "crewai-conversational-flows",
  variable: "AGENT_URL_CREWAI_CONVERSATIONAL_FLOWS",
  env: crewaiConversationalFlowsEnv,
  runtime: crewaiConversationalFlowsAgents,
  paths: Object.fromEntries(
    Object.entries(CREWAI_CREWS.paths).map(([path, demos]) => [
      `/conversational_flows${path}`,
      demos,
    ]),
  ),
  options: CREWAI_CREWS.options,
};

const GOOGLE_ADK: TodaysRoutes = {
  slug: "google-adk",
  variable: "AGENT_URL_GOOGLE_ADK",
  env: googleAdkEnv,
  runtime: googleAdkAgents,
  paths: {
    "/a2ui_fixed_schema": ["a2ui-fixed-schema"],
    "/a2ui_recovery": ["a2ui-recovery"],
    "/agent_config": ["agent-config"],
    "/agentic_chat": ["agentic-chat"],
    "/auth": ["auth"],
    "/beautiful_chat": ["beautiful-chat"],
    "/byoc_json_render": ["declarative-json-render"],
    "/chat-customization-css": ["chat-customization-css"],
    "/chat-slots": ["chat-slots"],
    "/declarative-hashbrown": ["declarative-hashbrown"],
    "/declarative_gen_ui": ["declarative-gen-ui"],
    "/frontend-tools-async": ["frontend-tools-async"],
    "/frontend_tools": ["frontend-tools"],
    "/gen-ui-agent": ["gen-ui-agent"],
    "/gen-ui-interrupt": ["gen-ui-interrupt"],
    "/gen-ui-tool-based": ["gen-ui-tool-based"],
    "/headless-simple": ["headless-simple"],
    "/headless_complete": ["headless-complete"],
    "/hitl-in-app": ["hitl-in-app"],
    "/hitl-in-chat": ["hitl-in-chat"],
    "/human_in_the_loop": ["hitl"],
    "/mcp-apps": ["mcp-apps"],
    "/multimodal": ["multimodal"],
    "/open_gen_ui": ["open-gen-ui"],
    "/open_gen_ui_advanced": ["open-gen-ui-advanced"],
    "/prebuilt-popup": ["prebuilt-popup"],
    "/prebuilt-sidebar": ["prebuilt-sidebar"],
    "/readonly-state-agent-context": ["readonly-state-agent-context"],
    "/reasoning-custom": ["reasoning-custom"],
    "/reasoning-default": ["reasoning-default"],
    "/shared-state-read": ["shared-state-read"],
    "/shared-state-read-write": ["shared-state-read-write"],
    "/shared-state-streaming": ["shared-state-streaming"],
    "/subagents": ["subagents"],
    "/threadid-frontend-tool-roundtrip": ["threadid-frontend-tool-roundtrip"],
    "/tool-rendering": ["tool-rendering"],
    "/tool-rendering-custom-catchall": ["tool-rendering-custom-catchall"],
    "/tool-rendering-default-catchall": ["tool-rendering-default-catchall"],
    "/tool-rendering-reasoning-chain": ["tool-rendering-reasoning-chain"],
    "/voice": ["voice"],
  },
  options: { ...COMMON_OPTIONS, "declarative-gen-ui": {} },
};

const GOOGLE_ANTIGRAVITY: TodaysRoutes = {
  slug: "google-antigravity",
  variable: "AGENT_URL_GOOGLE_ANTIGRAVITY",
  env: googleAntigravityEnv,
  runtime: googleAntigravityAgents,
  paths: {
    "/a2ui_fixed_schema": ["a2ui-fixed-schema"],
    "/a2ui_recovery": ["a2ui-recovery"],
    "/agent-config-demo": ["agent-config"],
    "/agentic_chat": ["agentic-chat"],
    "/auth": ["auth"],
    "/beautiful_chat": ["beautiful-chat"],
    "/chat-customization-css": ["chat-customization-css"],
    "/chat-slots": ["chat-slots"],
    "/declarative_gen_ui": ["declarative-gen-ui"],
    "/declarative_hashbrown": ["declarative-hashbrown"],
    "/declarative_json_render": ["declarative-json-render"],
    "/frontend-tools-async": ["frontend-tools-async"],
    "/frontend_tools": ["frontend-tools"],
    "/gen-ui-agent": ["gen-ui-agent"],
    "/gen-ui-tool-based": ["gen-ui-tool-based"],
    "/headless-simple": ["headless-simple"],
    "/headless_complete": ["headless-complete"],
    "/hitl-in-app": ["hitl-in-app"],
    "/hitl-in-chat": ["hitl-in-chat"],
    "/mcp-apps": ["mcp-apps"],
    "/multimodal-demo": ["multimodal"],
    "/open_gen_ui": ["open-gen-ui"],
    "/open_gen_ui_advanced": ["open-gen-ui-advanced"],
    "/prebuilt-popup": ["prebuilt-popup"],
    "/prebuilt-sidebar": ["prebuilt-sidebar"],
    "/readonly-state-agent-context": ["readonly-state-agent-context"],
    "/reasoning-custom": ["reasoning-custom"],
    "/reasoning-default": ["reasoning-default"],
    "/shared-state-read": ["shared-state-read"],
    "/shared-state-read-write": ["shared-state-read-write"],
    "/subagents": ["subagents"],
    "/threadid-frontend-tool-roundtrip": ["threadid-frontend-tool-roundtrip"],
    "/tool-rendering": ["tool-rendering"],
    "/tool-rendering-custom-catchall": ["tool-rendering-custom-catchall"],
    "/tool-rendering-default-catchall": ["tool-rendering-default-catchall"],
    "/tool-rendering-reasoning-chain": ["tool-rendering-reasoning-chain"],
    "/voice": ["voice"],
  },
  options: {
    ...COMMON_OPTIONS,
    "beautiful-chat": {
      ...BEAUTIFUL_CHAT_WITHOUT_MCP_APPS,
      ...mcpApps(EXCALIDRAW, "beautiful_chat_mcp"),
    },
    "headless-complete": mcpApps(EXCALIDRAW, "excalidraw"),
    "mcp-apps": mcpApps(EXCALIDRAW, "excalidraw"),
  },
};

// openai-agents-python's routes are google-antigravity's, plus three demos.
const OPENAI_AGENTS_PYTHON: TodaysRoutes = {
  slug: "openai-agents-python",
  variable: "AGENT_URL_OPENAI_AGENTS_PYTHON",
  env: openaiAgentsPythonEnv,
  runtime: openaiAgentsPythonAgents,
  paths: {
    ...GOOGLE_ANTIGRAVITY.paths,
    "/gen-ui-interrupt": ["gen-ui-interrupt"],
    "/interrupt-headless": ["interrupt-headless"],
    "/shared-state-streaming": ["shared-state-streaming"],
  },
  options: GOOGLE_ANTIGRAVITY.options,
};

const MS_AGENT_PYTHON: TodaysRoutes = {
  slug: "ms-agent-python",
  variable: "AGENT_URL_MS_AGENT_PYTHON",
  env: msAgentPythonEnv,
  runtime: msAgentPythonAgents,
  paths: {
    "/": [
      "agentic-chat",
      "auth",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "frontend-tools-async",
      "headless-simple",
      "hitl",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "shared-state-read",
    ],
    "/a2ui_dynamic": ["declarative-gen-ui"],
    "/a2ui_fixed": ["a2ui-fixed-schema"],
    "/a2ui_recovery": ["a2ui-recovery"],
    "/agent-config": ["agent-config"],
    "/beautiful-chat": ["beautiful-chat"],
    "/byoc-hashbrown": ["declarative-hashbrown"],
    "/byoc-json-render": ["declarative-json-render"],
    "/gen-ui-agent": ["gen-ui-agent"],
    "/gen-ui-tool-based": ["gen-ui-tool-based"],
    "/headless-complete": ["headless-complete"],
    "/hitl-in-app": ["hitl-in-app"],
    "/hitl-in-chat": ["hitl-in-chat"],
    "/interrupt-adapted": ["gen-ui-interrupt", "interrupt-headless"],
    "/mcp-apps": ["mcp-apps"],
    "/multimodal": ["multimodal"],
    "/open-gen-ui": ["open-gen-ui"],
    "/open-gen-ui-advanced": ["open-gen-ui-advanced"],
    "/readonly-state-agent-context": ["readonly-state-agent-context"],
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
    "/voice": ["voice"],
  },
  options: {
    ...COMMON_OPTIONS,
    "a2ui-recovery": {
      a2ui: { injectA2UITool: true, defaultCatalogId: DECLARATIVE_CATALOG },
    },
    "beautiful-chat": {
      ...COMMON_OPTIONS["beautiful-chat"],
      a2ui: { injectA2UITool: true, defaultCatalogId: APP_DASHBOARD_CATALOG },
    },
    "declarative-gen-ui": {
      a2ui: { injectA2UITool: true, defaultCatalogId: DECLARATIVE_CATALOG },
    },
  },
};

// tool-rendering-reasoning-chain is served (its page exists) but has no
// runtime: see NO_RUNTIME below.
const SPRING_AI: TodaysRoutes = {
  slug: "spring-ai",
  variable: "AGENT_URL_SPRING_AI",
  env: springAiEnv,
  runtime: springAiAgents,
  paths: {
    "/": [
      "agentic-chat",
      "auth",
      "beautiful-chat",
      "chat-customization-css",
      "chat-slots",
      "declarative-gen-ui",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-tool-based",
      "headless-complete",
      "headless-simple",
      "hitl",
      "hitl-in-app",
      "hitl-in-chat",
      "mcp-apps",
      "multimodal",
      "open-gen-ui",
      "open-gen-ui-advanced",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "readonly-state-agent-context",
      "shared-state-read",
      "shared-state-read-write",
      "shared-state-streaming",
      "threadid-frontend-tool-roundtrip",
      "tool-rendering",
      "tool-rendering-custom-catchall",
      "tool-rendering-default-catchall",
      "voice",
    ],
    "/a2ui-fixed-schema/run": ["a2ui-fixed-schema"],
    "/agent-config/run": ["agent-config"],
    "/byoc-hashbrown/run": ["declarative-hashbrown"],
    "/byoc-json-render/run": ["declarative-json-render"],
    "/gen-ui-agent/run": ["gen-ui-agent"],
    "/interrupt-adapted": ["gen-ui-interrupt", "interrupt-headless"],
    "/reasoning/": ["reasoning-custom", "reasoning-default"],
    "/subagents/run": ["subagents"],
  },
  options: {
    ...COMMON_OPTIONS,
    "a2ui-fixed-schema": {},
    "beautiful-chat": BEAUTIFUL_CHAT_WITHOUT_MCP_APPS,
  },
};

const CLAUDE_SDK_TYPESCRIPT: TodaysRoutes = {
  slug: "claude-sdk-typescript",
  variable: "AGENT_URL_CLAUDE_SDK_TYPESCRIPT",
  env: claudeSdkTypescriptEnv,
  runtime: claudeSdkTypescriptAgents,
  paths: {
    "/": [
      "agentic-chat",
      "auth",
      "chat-customization-css",
      "chat-slots",
      "frontend-tools",
      "frontend-tools-async",
      "gen-ui-interrupt",
      "gen-ui-tool-based",
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
      "threadid-frontend-tool-roundtrip",
      "voice",
    ],
    "/a2ui-fixed-schema": ["a2ui-fixed-schema"],
    "/agent-config": ["agent-config"],
    "/beautiful-chat": ["beautiful-chat"],
    "/byoc-hashbrown": ["declarative-hashbrown"],
    "/byoc-json-render": ["declarative-json-render"],
    "/declarative-gen-ui": ["declarative-gen-ui"],
    "/gen-ui-agent": ["gen-ui-agent"],
    "/headless-complete": ["headless-complete"],
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
    ...COMMON_OPTIONS,
    "beautiful-chat": {
      ...BEAUTIFUL_CHAT_WITHOUT_MCP_APPS,
      ...mcpApps(EXCALIDRAW, "excalidraw"),
    },
  },
};

const INTEGRATIONS = [
  STRANDS,
  STRANDS_TYPESCRIPT,
  AGNO,
  CREWAI_CREWS,
  CREWAI_CONVERSATIONAL_FLOWS,
  GOOGLE_ADK,
  GOOGLE_ANTIGRAVITY,
  MS_AGENT_PYTHON,
  OPENAI_AGENTS_PYTHON,
  SPRING_AI,
  CLAUDE_SDK_TYPESCRIPT,
];

// Served demos that have no runtime, by slug. spring-ai's manifest marks
// tool-rendering-reasoning-chain as not supported, and its route registers no
// agent for it, so that its page fails loudly.
const NO_RUNTIME: Partial<Record<string, string[]>> = {
  "spring-ai": ["tool-rendering-reasoning-chain"],
};

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

// The one agent of a demo.
function agentOf(runtime: IntegrationRuntime, demo: string) {
  const [agent] = Object.values(configOf(runtime, demo).agents);
  return httpAgentOf(agent);
}

beforeEach(() => {
  for (const { slug, variable } of INTEGRATIONS) {
    vi.stubEnv(variable, agentServer(slug));
  }
  vi.stubEnv("MCP_SERVER_URL", undefined);
  vi.stubEnv("OPENAI_TRANSCRIPTION_API_KEY", undefined);
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
  const noRuntime = NO_RUNTIME[slug] ?? [];
  const urls = urlsByDemo(routes);
  const demosWithRuntime = served.filter((demo) => !noRuntime.includes(demo));

  it("points its one address variable at port 8000", () => {
    expect(env).toEqual({ [variable]: { port: 8000 } });
  });

  it("has today's agent path for every demo it serves", () => {
    expect([...urls.keys(), ...noRuntime].sort()).toEqual([...served].sort());
  });

  // The route adds DEMO_RUNTIME_OPTIONS under the integration's options, as
  // here. The voice route also adds its transcription service: see below.
  it.each(demosWithRuntime)(
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

  it("returns undefined for every other demo", () => {
    const otherDemos = [...Object.keys(DEMO_AGENT_IDS), "no-such-demo"].filter(
      (demo) => !demosWithRuntime.includes(demo),
    );

    const configured = otherDemos.filter(
      (demo) => runtime.createRuntimeConfig(demo) !== undefined,
    );

    expect(configured).toEqual([]);
  });
});

describe("voice transcription", () => {
  const ownTranscription = [
    GOOGLE_ADK,
    GOOGLE_ANTIGRAVITY,
    MS_AGENT_PYTHON,
    OPENAI_AGENTS_PYTHON,
  ];
  const routeTranscription = INTEGRATIONS.filter(
    (routes) => !ownTranscription.includes(routes),
  );

  it.each(ownTranscription)(
    "$slug transcribes with OPENAI_TRANSCRIPTION_API_KEY",
    ({ runtime }) => {
      vi.stubEnv("OPENAI_TRANSCRIPTION_API_KEY", "sk-transcription");

      const { options } = configOf(runtime, "voice");

      expect(options?.transcriptionService).toBeInstanceOf(
        TranscriptionServiceOpenAI,
      );
    },
  );

  it.each(ownTranscription)(
    "$slug has no transcription without OPENAI_TRANSCRIPTION_API_KEY",
    ({ runtime }) => {
      expect(configOf(runtime, "voice").options).toStrictEqual({
        transcriptionService: undefined,
      });
    },
  );

  it.each(routeTranscription)(
    "$slug keeps the voice route's transcription service",
    ({ runtime }) => {
      expect(configOf(runtime, "voice").options).toBeUndefined();
    },
  );
});

describe("claude-sdk-typescript's agents", () => {
  const demos = servedDemos("claude-sdk-typescript");

  function agentHeaders() {
    return demos.map(
      (demo) => agentOf(claudeSdkTypescriptAgents, demo).headers,
    );
  }

  it.each(["ANTHROPIC_BASE_URL", "AIMOCK_URL"])(
    "send x-aimock-context: claude-sdk-typescript when %s points at aimock",
    (variable) => {
      vi.stubEnv(variable, "http://aimock:4010");

      expect(agentHeaders()).toEqual(
        demos.map(() => ({ "x-aimock-context": "claude-sdk-typescript" })),
      );
    },
  );

  it("send no headers of their own when Claude calls go to Anthropic", () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");

    expect(agentHeaders()).toEqual(demos.map(() => ({})));
  });
});

// The tool call ids in `messages`: the calls of assistant messages and the
// calls that tool results answer.
function toolCallIdsIn(messages: Message[]) {
  return messages.flatMap((message) => {
    if (message.role === "assistant") {
      return (message.toolCalls ?? []).map((toolCall) => toolCall.id);
    }
    return message.role === "tool" ? [message.toolCallId] : [];
  });
}

// The ms-agent-python adapters run on a clone of the demo's agent, as in the
// runtime, against a fake agent server.
describe("ms-agent-python's adapters", () => {
  const RUN_ID = "5f8c2e1a-9b7d-4c3e-8a6f-1d2e3f4a5b6c";
  const EARLIER_RUN_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

  // Stands in for the agent server: records each posted run, and answers it
  // with `events` between RUN_STARTED and RUN_FINISHED.
  function fakeAgentServer(events: BaseEvent[] = []) {
    const runs: RunAgentInput[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const run: RunAgentInput = JSON.parse(String(init.body));
      runs.push(run);
      const ids = { threadId: run.threadId, runId: run.runId };
      const stream = [
        { type: EventType.RUN_STARTED, ...ids },
        ...events,
        { type: EventType.RUN_FINISHED, ...ids },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`);
      return new Response(stream.join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    });
    return runs;
  }

  // Runs a clone of the demo's agent, starting from `messages` and `state`.
  async function runDemo(
    demo: string,
    { messages = [], state = {} }: { messages?: Message[]; state?: State } = {},
  ) {
    const clone = agentOf(msAgentPythonAgents, demo).clone();
    clone.setMessages(messages);
    clone.setState(state);
    const { newMessages } = await clone.runAgent({ runId: RUN_ID });
    return { clone, newMessages };
  }

  function toolCallEvents(toolCallId: string, toolCallName: string) {
    return [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName,
        parentMessageId: `message-${toolCallId}`,
      },
      { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: "{}" },
      { type: EventType.TOOL_CALL_END, toolCallId },
    ];
  }

  function user(id: string) {
    return { id, role: "user", content: "Plan my week" } satisfies Message;
  }

  function assistantCalling(id: string, toolCallId: string, content = "") {
    return {
      id,
      role: "assistant",
      content,
      toolCalls: [
        {
          id: toolCallId,
          type: "function",
          function: { name: "generate_task_steps", arguments: "{}" },
        },
      ],
    } satisfies Message;
  }

  function toolResult(id: string, toolCallId: string, content: string) {
    return { id, role: "tool", toolCallId, content } satisfies Message;
  }

  it("gives each run's replay-safe tool calls an id of their own, and leaves other calls alone", async () => {
    fakeAgentServer([
      ...toolCallEvents("call_1", "generate_task_steps"),
      ...toolCallEvents("call_2", "lookup_calendar"),
    ]);

    const { newMessages } = await runDemo("hitl");

    expect(toolCallIdsIn(newMessages)).toEqual([
      `call_1__ck_run_${RUN_ID}`,
      "call_2",
    ]);
  });

  it.each([
    ['{"approved":true}', "call_1__approved"],
    ['{"accepted":false}', "call_1__rejected"],
    ['{"cancelled":true}', "call_1__cancelled"],
    ["Cancelled: no time was picked.", "call_1__cancelled"],
    ['{"status":"done"}', "call_1"],
  ])(
    "sends a call answered with %s to the server as %s",
    async (result, sentId) => {
      const runs = fakeAgentServer();
      const callId = `call_1__ck_run_${EARLIER_RUN_ID}`;

      await runDemo("gen-ui-interrupt", {
        messages: [
          user("user-1"),
          assistantCalling("assistant-1", callId),
          toolResult("tool-1", callId, result),
        ],
      });

      expect(toolCallIdsIn(runs[0].messages)).toEqual([sentId, sentId]);
    },
  );

  it("sends no tool calls or results from before a new user message", async () => {
    const runs = fakeAgentServer();

    await runDemo("hitl-in-chat", {
      messages: [
        user("user-1"),
        assistantCalling("assistant-1", "call_1"),
        toolResult("tool-1", "call_1", '{"approved":true}'),
        assistantCalling("assistant-2", "call_2", "Booked."),
        toolResult("tool-2", "call_2", '{"approved":true}'),
        user("user-2"),
      ],
    });

    expect(runs[0].messages).toEqual([
      user("user-1"),
      { id: "assistant-2", role: "assistant", content: "Booked." },
      user("user-2"),
    ]);
  });

  it("turns the gen-ui-agent's set_steps calls into agent state, and leaves other calls alone", async () => {
    const steps = [{ description: "Draft the plan", status: "pending" }];
    fakeAgentServer([
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "call_steps",
        toolCallName: "set_steps",
        parentMessageId: "message-steps",
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "call_steps",
        delta: '{"steps":[{"description":"Draft the plan",',
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "call_steps",
        delta: '"status":"pending"}]}',
      },
      { type: EventType.TOOL_CALL_END, toolCallId: "call_steps" },
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "result-steps",
        toolCallId: "call_steps",
        content: "ok",
      },
      ...toolCallEvents("call_lookup", "lookup_calendar"),
    ]);

    const { clone, newMessages } = await runDemo("gen-ui-agent");

    expect({
      state: clone.state,
      toolCallIds: toolCallIdsIn(newMessages),
    }).toEqual({ state: { steps }, toolCallIds: ["call_lookup"] });
  });

  it("starts each shared-state-read-write run with the user's preferences", async () => {
    const runs = fakeAgentServer();

    await runDemo("shared-state-read-write", {
      messages: [user("user-1")],
      state: {
        preferences: {
          name: "Ada",
          tone: "formal",
          language: "French",
          interests: ["chess", 7],
        },
      },
    });

    const [system, ...rest] = runs[0].messages;
    expect(system).toMatchObject({
      id: `${RUN_ID}-shared-state`,
      role: "system",
    });
    expect(system.content).toContain(
      [
        "[shared-state-read-write] preferences:",
        "{",
        '  "name": "Ada",',
        '  "tone": "formal",',
        '  "language": "French",',
        '  "interests": ["chess"]',
        "}",
      ].join("\n"),
    );
    expect(rest).toEqual([user("user-1")]);
  });

  it("uses the default preferences when the state has none", async () => {
    const runs = fakeAgentServer();

    await runDemo("shared-state-read-write", { messages: [user("user-1")] });

    expect(runs[0].messages[0].content).toContain(
      [
        "{",
        '  "name": "",',
        '  "tone": "casual",',
        '  "language": "English",',
        '  "interests": []',
        "}",
      ].join("\n"),
    );
  });
});
