// The CopilotRuntime options of each demo, by demo id. A demo that is not
// here needs no options. Each value is the one that most integrations use. An
// integration that needs another value returns it in the `options` of its
// `createRuntimeConfig`, which replaces the entry key by key:
//
//   new CopilotRuntime({ ...DEMO_RUNTIME_OPTIONS[demo], ...config.options, agents })
import type { McpAppsConfig } from "@copilotkit/runtime/v2";
import type { RuntimeOptions } from "@/lib/agents";

// One MCP Apps server at MCP_SERVER_URL. `url` is a getter, so the variable is
// read each time the runtime connects to the server, not when this module
// loads. A fixed `serverId` keeps MCP Apps in earlier threads restorable when
// the URL changes.
function mcpServer(serverId: string) {
  return {
    servers: [
      {
        type: "http",
        get url() {
          return process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com";
        },
        serverId,
      },
    ],
  } satisfies McpAppsConfig;
}

// Each Open Generative UI demo runs its own runtime, and both list the two
// agent ids.
const OPEN_GENERATIVE_UI = {
  openGenerativeUI: { agents: ["open-gen-ui", "open-gen-ui-advanced"] },
} satisfies RuntimeOptions;

// The A2UI catalog that the declarative-gen-ui page registers. a2ui-recovery
// renders with the same catalog.
const DECLARATIVE_GEN_UI_A2UI = {
  a2ui: {
    injectA2UITool: false,
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
} satisfies RuntimeOptions;

/** The runtime options of each demo that needs them, by demo id. */
export const DEMO_RUNTIME_OPTIONS: Partial<Record<string, RuntimeOptions>> = {
  "a2ui-fixed-schema": {
    // The agent emits the A2UI envelope itself.
    a2ui: { injectA2UITool: false },
  },
  "a2ui-recovery": DECLARATIVE_GEN_UI_A2UI,
  "beautiful-chat": {
    openGenerativeUI: true,
    a2ui: {
      injectA2UITool: false,
      defaultCatalogId: "copilotkit://app-dashboard-catalog",
    },
    mcpApps: mcpServer("beautiful_chat_mcp"),
  },
  "declarative-gen-ui": DECLARATIVE_GEN_UI_A2UI,
  "headless-complete": { mcpApps: mcpServer("excalidraw") },
  "mcp-apps": { mcpApps: mcpServer("excalidraw") },
  "open-gen-ui": OPEN_GENERATIVE_UI,
  "open-gen-ui-advanced": OPEN_GENERATIVE_UI,
};
