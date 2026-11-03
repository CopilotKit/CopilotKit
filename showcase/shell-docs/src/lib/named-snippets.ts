// Shared by the MDX config (source.config.ts), which inlines these snippets
// into the page so their headings reach its TOC, and by the page markdown.

/**
 * Snippets pages use by name without importing them: shell-docs'
 * `SNIPPET_MAP`, the paths behind `src/components/docs-mdx/snippets.tsx`.
 */
export const NAMED_SNIPPETS: Record<string, string> = {
  A2UI: "shared/generative-ui/a2ui.mdx",
  AgUI: "shared/backend/ag-ui.mdx",
  AGUI: "shared/backend/ag-ui.mdx",
  BuildWithAgents: "shared/guides/build-with-agents.mdx",
  CodingAgents: "shared/coding-agents.mdx",
  CommonIssues: "shared/troubleshooting/common-issues.mdx",
  CopilotCloudConfigureCopilotKit:
    "copilot-cloud-configure-copilotkit-provider.mdx",
  CopilotCloudConfigureCopilotKitProvider:
    "copilot-cloud-configure-copilotkit-provider.mdx",
  CopilotRuntime: "copilot-runtime.mdx",
  CopilotUI: "copilot-ui.mdx",
  CustomAgent: "shared/backend/custom-agent.mdx",
  DebugMode: "shared/troubleshooting/debug-mode.mdx",
  DefaultToolRendering: "shared/guides/default-tool-rendering.mdx",
  DisplayOnly: "shared/generative-ui/display-only.mdx",
  ErrorDebugging: "shared/troubleshooting/error-debugging.mdx",
  FrontEndToolsImpl: "shared/app-control/frontend-tools.mdx",
  FrontendTools: "shared/app-control/frontend-tools.mdx",
  GenerativeUISpecsOverview: "shared/generative-ui-specs-overview.mdx",
  HeadlessThreads: "shared/threads/headless-threads.mdx",
  HeadlessUI: "shared/basics/headless-ui.mdx",
  Inspector: "shared/intelligence/inspector.mdx",
  InstallPythonSDK: "install-python-sdk.mdx",
  InstallSDKSnippet: "install-sdk.mdx",
  Interactive: "shared/generative-ui/interactive.mdx",
  LandingCodeShowcase: "landing-code-showcase.mdx",
  LangGraphPlatformDeploymentTabs: "langgraph-platform-deployment-tabs.mdx",
  MCPApps: "shared/generative-ui/mcp-apps.mdx",
  MCPSetup: "shared/guides/mcp-server-setup.mdx",
  MigrateTo: "shared/troubleshooting/migrate-to-v2.mdx",
  MigrateToV: "shared/troubleshooting/migrate-to-v2.mdx",
  MigrateTo1100: "shared/troubleshooting/migrate-to-1.10.X.mdx",
  MigrateTo182: "shared/troubleshooting/migrate-to-1.8.2.mdx",
  MigrateToV2: "shared/troubleshooting/migrate-to-v2.mdx",
  Overview: "shared/intelligence/overview.mdx",
  PrebuiltComponents: "shared/basics/prebuilt-components.mdx",
  ProgrammaticControl: "shared/basics/programmatic-control.mdx",
  ReasoningMessages:
    "shared/guides/custom-look-and-feel/reasoning-messages.mdx",
  RunAndConnect: "coagents/run-and-connect-agent.mdx",
  RunAndConnectSnippet: "coagents/run-and-connect-agent.mdx",
  SelfHosting: "shared/intelligence/self-hosting.mdx",
  SelfHostingCopilotRuntimeConfigureCopilotKit:
    "self-hosting-copilot-runtime-configure-copilotkit-provider.mdx",
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider:
    "self-hosting-copilot-runtime-configure-copilotkit-provider.mdx",
  Slots: "shared/basics/slots.mdx",
  Threads: "shared/threads/headless-threads.mdx",
  ThreadsOverview: "shared/threads/overview.mdx",
  ToolRenderer: "shared/generative-ui/tool-rendering.mdx",
  ToolRendering: "shared/generative-ui/tool-rendering.mdx",
  UseAgentSnippet: "use-agent.mdx",
};
