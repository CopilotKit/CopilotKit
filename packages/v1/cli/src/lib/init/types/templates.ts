export type ChatTemplate = "CopilotChat" | "CopilotPopup" | "CopilotSidebar";

export type StarterTemplate =
  | "LangGraphPlatform"
  | "RemoteEndpoint"
  | "Standard"
  | "CrewEnterprise"
  | "CrewFlowsStarter";

export type Template = ChatTemplate | StarterTemplate;

const BASE_URL = "https://registry.copilotkit.ai/r";

export const templateMapping = {
  // Runtimes
  RemoteEndpoint: `${BASE_URL}/remote-endpoint.json`,
  LangGraphPlatformRuntime: `${BASE_URL}/langgraph-platform-runtime.json`,

  // CrewAI
  CrewEnterprise: [`${BASE_URL}/coagents-crew-starter.json`],
  CrewFlowsEnterprise: [`${BASE_URL}/coagents-starter-crewai-flows.json`],

  // LangGraph
  LangGraphGeneric: `${BASE_URL}/generic-lg-starter.json`,
  LangGraphStarter: [
    `${BASE_URL}/langgraph-platform-starter.json`,
    `${BASE_URL}/coagents-starter-ui.json`,
  ],

  // No Agent
  StandardStarter: `${BASE_URL}/standard-starter.json`,
  StandardRuntime: `${BASE_URL}/standard-runtime.json`,

  // MCP
  McpStarter: `${BASE_URL}/mcp-starter.json`,
  McpRuntime: `${BASE_URL}/mcp-starter-runtime.json`,
};
