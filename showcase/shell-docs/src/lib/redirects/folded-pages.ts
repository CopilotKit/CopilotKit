import type { RedirectEntry } from "./seo-redirects";

/**
 * URLs of the per-framework pages folded into the shared pages. A folded page
 * whose slug matches a shared page needs no entry: the shared page serves its
 * URL with the framework's code. These are the ones that had a slug of their
 * own (`/mastra/ag-ui`), sent to the page that now covers the topic.
 */
export const FOLDED_PAGES: RedirectEntry[] = [
  { id: "FOLD", source: "/ag2/ag-ui", destination: "/ag2/backend/ag-ui" },
  {
    id: "FOLD",
    source: "/ag2/copilot-runtime",
    destination: "/ag2/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/ag2/generative-ui/your-components/display-only",
    destination: "/ag2/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/ag2/generative-ui/your-components/interactive",
    destination: "/ag2/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/ag2/readables",
    destination: "/ag2/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/ag2/shared-state/read",
    destination: "/ag2/shared-state",
  },
  {
    id: "FOLD",
    source: "/ag2/shared-state/write",
    destination: "/ag2/shared-state#writing-agent-state",
  },
  {
    id: "FOLD",
    source: "/ag2/troubleshooting/migrate-to-1.10.X",
    destination: "/ag2/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/ag2/troubleshooting/migrate-to-1.8.2",
    destination: "/ag2/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/ag2/troubleshooting/migrate-to-v2",
    destination: "/ag2/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/agent-app-context",
    destination: "/shared-state/agent-readonly",
  },
  { id: "FOLD", source: "/agno/ag-ui", destination: "/agno/backend/ag-ui" },
  {
    id: "FOLD",
    source: "/agno/copilot-runtime",
    destination: "/agno/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/agno/generative-ui/your-components/display-only",
    destination: "/agno/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/agno/generative-ui/your-components/interactive",
    destination: "/agno/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/agno/troubleshooting/migrate-to-1.10.X",
    destination: "/agno/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/agno/troubleshooting/migrate-to-1.8.2",
    destination: "/agno/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/agno/troubleshooting/migrate-to-v2",
    destination: "/agno/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/ag-ui",
    destination: "/crewai-crews/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/agent-app-context",
    destination: "/crewai-crews/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/copilot-runtime",
    destination: "/crewai-crews/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/generative-ui/your-components/display-only",
    destination: "/crewai-crews/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/generative-ui/your-components/interactive",
    destination: "/crewai-crews/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/human-in-the-loop/flow",
    destination: "/crewai-crews/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/multi-agent-flows",
    destination: "/crewai-crews/multi-agent/subagents",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/persistence/loading-agent-state",
    destination: "/crewai-crews/threads-lifecycle",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/persistence/loading-message-history",
    destination: "/crewai-crews/threads-lifecycle",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/shared-state/in-app-agent-read",
    destination: "/crewai-crews/shared-state/rendering-in-app",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/shared-state/in-app-agent-write",
    destination: "/crewai-crews/shared-state",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/shared-state/predictive-state-updates",
    destination: "/crewai-crews/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/troubleshooting/migrate-to-1.10.X",
    destination: "/crewai-crews/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/troubleshooting/migrate-to-1.8.2",
    destination: "/crewai-crews/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/crewai-crews/troubleshooting/migrate-to-v2",
    destination: "/crewai-crews/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/deepagents/generative-ui/your-components/interrupt-based",
    destination: "/deepagents/human-in-the-loop/useInterrupt",
  },
  {
    id: "FOLD",
    source: "/deepagents/human-in-the-loop/interrupt-flow",
    destination: "/deepagents/human-in-the-loop/useInterrupt",
  },
  {
    id: "FOLD",
    source: "/deepagents/shared-state/in-app-agent-read",
    destination: "/deepagents/shared-state",
  },
  {
    id: "FOLD",
    source: "/deepagents/shared-state/in-app-agent-write",
    destination: "/deepagents/shared-state",
  },
  {
    id: "FOLD",
    source: "/deepagents/shared-state/predictive-state-updates",
    destination: "/deepagents/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/deepagents/shared-state/state-inputs-outputs",
    destination: "/deepagents/shared-state",
  },
  {
    id: "FOLD",
    source: "/deepagents/shared-state/workflow-execution",
    destination: "/deepagents/shared-state",
  },
  {
    id: "FOLD",
    source: "/generative-ui/your-components/display-only",
    destination: "/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/generative-ui/your-components/interactive",
    destination: "/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/google-adk/agent-app-context",
    destination: "/google-adk/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/google-adk/deploy-langsmith",
    destination: "/google-adk/deploy/langsmith",
  },
  {
    id: "FOLD",
    source: "/google-adk/shared-state/in-app-agent-read",
    destination: "/google-adk/shared-state",
  },
  {
    id: "FOLD",
    source: "/google-adk/shared-state/in-app-agent-write",
    destination: "/google-adk/shared-state",
  },
  {
    id: "FOLD",
    source: "/google-adk/shared-state/predictive-state-updates",
    destination: "/google-adk/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/google-adk/shared-state/workflow-execution",
    destination: "/google-adk/shared-state",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/advanced/persistence/loading-agent-state",
    destination: "/langgraph-fastapi/threads-lifecycle",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/advanced/persistence/loading-message-history",
    destination: "/langgraph-fastapi/threads-lifecycle",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/ag-ui",
    destination: "/langgraph-fastapi/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/agent-app-context",
    destination: "/langgraph-fastapi/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/coagent-troubleshooting/error-debugging",
    destination: "/langgraph-fastapi/troubleshooting/error-debugging",
  },
  {
    id: "FOLD",
    source:
      "/langgraph-fastapi/coagent-troubleshooting/migrate-from-v0.2-to-v0.3",
    destination: "/langgraph-fastapi/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/copilot-runtime",
    destination: "/langgraph-fastapi/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/deep-agents",
    destination: "/deepagents/quickstart",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/deploy-agentcore",
    destination: "/langgraph-fastapi/deploy/agentcore",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/deploy-langsmith",
    destination: "/langgraph-fastapi/deploy/langsmith",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/generative-ui/your-components/display-only",
    destination: "/langgraph-fastapi/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/generative-ui/your-components/interactive",
    destination: "/langgraph-fastapi/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/generative-ui/your-components/interrupt-based",
    destination: "/langgraph-fastapi/human-in-the-loop/interrupt-flow",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/multi-agent-flows",
    destination: "/langgraph-fastapi/multi-agent/subagents",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/shared-state/in-app-agent-read",
    destination: "/langgraph-fastapi/shared-state",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/shared-state/in-app-agent-write",
    destination: "/langgraph-fastapi/shared-state",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/shared-state/predictive-state-updates",
    destination: "/langgraph-fastapi/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/shared-state/workflow-execution",
    destination: "/langgraph-fastapi/shared-state/state-inputs-outputs",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/troubleshooting/migrate-to-1.10.X",
    destination: "/langgraph-fastapi/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/troubleshooting/migrate-to-1.8.2",
    destination: "/langgraph-fastapi/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/langgraph-fastapi/troubleshooting/migrate-to-v2",
    destination: "/langgraph-fastapi/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/advanced/persistence/loading-agent-state",
    destination: "/langgraph-python/threads-lifecycle",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/advanced/persistence/loading-message-history",
    destination: "/langgraph-python/threads-lifecycle",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/ag-ui",
    destination: "/langgraph-python/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/agent-app-context",
    destination: "/langgraph-python/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/coagent-troubleshooting/error-debugging",
    destination: "/langgraph-python/troubleshooting/error-debugging",
  },
  {
    id: "FOLD",
    source:
      "/langgraph-python/coagent-troubleshooting/migrate-from-v0.2-to-v0.3",
    destination: "/langgraph-python/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/copilot-runtime",
    destination: "/langgraph-python/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/deploy-agentcore",
    destination: "/langgraph-python/deploy/agentcore",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/deploy-langsmith",
    destination: "/langgraph-python/deploy/langsmith",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/generative-ui/your-components/display-only",
    destination: "/langgraph-python/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/generative-ui/your-components/interactive",
    destination: "/langgraph-python/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/generative-ui/your-components/interrupt-based",
    destination: "/langgraph-python/human-in-the-loop/interrupt-flow",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/multi-agent-flows",
    destination: "/langgraph-python/multi-agent/subagents",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/shared-state/in-app-agent-read",
    destination: "/langgraph-python/shared-state",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/shared-state/in-app-agent-write",
    destination: "/langgraph-python/shared-state",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/shared-state/predictive-state-updates",
    destination: "/langgraph-python/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/shared-state/workflow-execution",
    destination: "/langgraph-python/shared-state/state-inputs-outputs",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/troubleshooting/migrate-to-1.10.X",
    destination: "/langgraph-python/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/troubleshooting/migrate-to-1.8.2",
    destination: "/langgraph-python/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/langgraph-python/troubleshooting/migrate-to-v2",
    destination: "/langgraph-python/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/advanced/persistence/loading-agent-state",
    destination: "/langgraph-typescript/threads-lifecycle",
  },
  {
    id: "FOLD",
    source:
      "/langgraph-typescript/advanced/persistence/loading-message-history",
    destination: "/langgraph-typescript/threads-lifecycle",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/ag-ui",
    destination: "/langgraph-typescript/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/agent-app-context",
    destination: "/langgraph-typescript/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/coagent-troubleshooting/error-debugging",
    destination: "/langgraph-typescript/troubleshooting/error-debugging",
  },
  {
    id: "FOLD",
    source:
      "/langgraph-typescript/coagent-troubleshooting/migrate-from-v0.2-to-v0.3",
    destination: "/langgraph-typescript/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/copilot-runtime",
    destination: "/langgraph-typescript/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/deep-agents",
    destination: "/deepagents/quickstart",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/deploy-agentcore",
    destination: "/langgraph-typescript/deploy/agentcore",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/deploy-langsmith",
    destination: "/langgraph-typescript/deploy/langsmith",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/generative-ui/your-components/display-only",
    destination: "/langgraph-typescript/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/generative-ui/your-components/interactive",
    destination: "/langgraph-typescript/human-in-the-loop",
  },
  {
    id: "FOLD",
    source:
      "/langgraph-typescript/generative-ui/your-components/interrupt-based",
    destination: "/langgraph-typescript/human-in-the-loop/interrupt-flow",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/multi-agent-flows",
    destination: "/langgraph-typescript/multi-agent/subagents",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/shared-state/in-app-agent-read",
    destination: "/langgraph-typescript/shared-state",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/shared-state/in-app-agent-write",
    destination: "/langgraph-typescript/shared-state",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/shared-state/predictive-state-updates",
    destination: "/langgraph-typescript/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/shared-state/workflow-execution",
    destination: "/langgraph-typescript/shared-state/state-inputs-outputs",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/troubleshooting/migrate-to-1.10.X",
    destination: "/langgraph-typescript/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/troubleshooting/migrate-to-1.8.2",
    destination: "/langgraph-typescript/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/langgraph-typescript/troubleshooting/migrate-to-v2",
    destination: "/langgraph-typescript/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/llamaindex/ag-ui",
    destination: "/llamaindex/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/llamaindex/copilot-runtime",
    destination: "/llamaindex/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/llamaindex/generative-ui/your-components/display-only",
    destination: "/llamaindex/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/llamaindex/generative-ui/your-components/interactive",
    destination: "/llamaindex/generative-ui/interactive",
  },
  {
    id: "FOLD",
    source: "/llamaindex/multi-agent-flows",
    destination: "/llamaindex/multi-agent/subagents",
  },
  {
    id: "FOLD",
    source: "/llamaindex/shared-state/in-app-agent-read",
    destination: "/llamaindex/shared-state/rendering-in-app",
  },
  {
    id: "FOLD",
    source: "/llamaindex/shared-state/in-app-agent-write",
    destination: "/llamaindex/shared-state",
  },
  {
    id: "FOLD",
    source: "/llamaindex/shared-state/predictive-state-updates",
    destination: "/llamaindex/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/llamaindex/troubleshooting/migrate-to-1.10.X",
    destination: "/llamaindex/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/llamaindex/troubleshooting/migrate-to-1.8.2",
    destination: "/llamaindex/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/llamaindex/troubleshooting/migrate-to-v2",
    destination: "/llamaindex/migrate/v2",
  },
  { id: "FOLD", source: "/mastra/ag-ui", destination: "/mastra/backend/ag-ui" },
  {
    id: "FOLD",
    source: "/mastra/agent-app-context",
    destination: "/mastra/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/mastra/copilot-runtime",
    destination: "/mastra/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/mastra/generative-ui/your-components/display-only",
    destination: "/mastra/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/mastra/generative-ui/your-components/interactive",
    destination: "/mastra/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/mastra/human-in-the-loop/interrupt-flow",
    destination: "/mastra/human-in-the-loop/useInterrupt",
  },
  {
    id: "FOLD",
    source: "/mastra/human-in-the-loop/tool-based",
    destination: "/mastra/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/mastra/shared-state/in-app-agent-read",
    destination: "/mastra/shared-state",
  },
  {
    id: "FOLD",
    source: "/mastra/shared-state/in-app-agent-write",
    destination: "/mastra/shared-state#writing-agent-state",
  },
  {
    id: "FOLD",
    source: "/mastra/shared-state/predictive-state-updates",
    destination: "/mastra/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/mastra/troubleshooting/migrate-to-1.10.X",
    destination: "/mastra/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/mastra/troubleshooting/migrate-to-1.8.2",
    destination: "/mastra/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/mastra/troubleshooting/migrate-to-v2",
    destination: "/mastra/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/ag-ui",
    destination: "/ms-agent-dotnet/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/agent-app-context",
    destination: "/ms-agent-dotnet/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/copilot-runtime",
    destination: "/ms-agent-dotnet/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/generative-ui/your-components/display-only",
    destination: "/ms-agent-dotnet/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/generative-ui/your-components/interactive",
    destination: "/ms-agent-dotnet/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/human-in-the-loop/tool-based",
    destination: "/ms-agent-dotnet/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/shared-state/in-app-agent-read",
    destination: "/ms-agent-dotnet/shared-state",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/shared-state/in-app-agent-write",
    destination: "/ms-agent-dotnet/shared-state",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/shared-state/predictive-state-updates",
    destination: "/ms-agent-dotnet/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/ms-agent-dotnet/troubleshooting/migrate-to-v2",
    destination: "/ms-agent-dotnet/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/ag-ui",
    destination: "/ms-agent-harness-dotnet/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/agent-app-context",
    destination: "/ms-agent-harness-dotnet/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/copilot-runtime",
    destination: "/ms-agent-harness-dotnet/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source:
      "/ms-agent-harness-dotnet/generative-ui/your-components/display-only",
    destination: "/ms-agent-harness-dotnet/generative-ui/display",
  },
  {
    id: "FOLD",
    source:
      "/ms-agent-harness-dotnet/generative-ui/your-components/interactive",
    destination: "/ms-agent-harness-dotnet/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/human-in-the-loop/tool-based",
    destination: "/ms-agent-harness-dotnet/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/shared-state/in-app-agent-read",
    destination: "/ms-agent-harness-dotnet/shared-state",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/shared-state/in-app-agent-write",
    destination: "/ms-agent-harness-dotnet/shared-state",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/shared-state/predictive-state-updates",
    destination: "/ms-agent-harness-dotnet/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/ms-agent-harness-dotnet/troubleshooting/migrate-to-v2",
    destination: "/ms-agent-harness-dotnet/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/ag-ui",
    destination: "/ms-agent-python/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/agent-app-context",
    destination: "/ms-agent-python/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/copilot-runtime",
    destination: "/ms-agent-python/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/generative-ui/your-components/display-only",
    destination: "/ms-agent-python/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/generative-ui/your-components/interactive",
    destination: "/ms-agent-python/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/human-in-the-loop/tool-based",
    destination: "/ms-agent-python/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/shared-state/in-app-agent-read",
    destination: "/ms-agent-python/shared-state",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/shared-state/in-app-agent-write",
    destination: "/ms-agent-python/shared-state",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/shared-state/predictive-state-updates",
    destination: "/ms-agent-python/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/ms-agent-python/troubleshooting/migrate-to-v2",
    destination: "/ms-agent-python/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/ag-ui",
    destination: "/pydantic-ai/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/agent-app-context",
    destination: "/pydantic-ai/shared-state/agent-readonly",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/copilot-runtime",
    destination: "/pydantic-ai/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/generative-ui/your-components/display-only",
    destination: "/pydantic-ai/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/generative-ui/your-components/interactive",
    destination: "/pydantic-ai/generative-ui/interactive",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/human-in-the-loop/agent",
    destination: "/pydantic-ai/human-in-the-loop",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/multi-agent-flows",
    destination: "/pydantic-ai/multi-agent/subagents",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/shared-state/in-app-agent-read",
    destination: "/pydantic-ai/shared-state/rendering-in-app",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/shared-state/in-app-agent-write",
    destination: "/pydantic-ai/shared-state",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/shared-state/predictive-state-updates",
    destination: "/pydantic-ai/shared-state/streaming",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/troubleshooting/migrate-to-1.10.X",
    destination: "/pydantic-ai/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/troubleshooting/migrate-to-1.8.2",
    destination: "/pydantic-ai/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/pydantic-ai/troubleshooting/migrate-to-v2",
    destination: "/pydantic-ai/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/ag-ui",
    destination: "/strands-typescript/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/copilot-runtime",
    destination: "/strands-typescript/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/deploy-agentcore",
    destination: "/strands-typescript/deploy/agentcore",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/generative-ui/your-components/display-only",
    destination: "/strands-typescript/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/generative-ui/your-components/interactive",
    destination: "/strands-typescript/generative-ui/interactive",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/shared-state/in-app-agent-read",
    destination: "/strands-typescript/shared-state",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/shared-state/in-app-agent-write",
    destination: "/strands-typescript/shared-state",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/troubleshooting/migrate-to-1.10.X",
    destination: "/strands-typescript/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/troubleshooting/migrate-to-1.8.2",
    destination: "/strands-typescript/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/strands-typescript/troubleshooting/migrate-to-v2",
    destination: "/strands-typescript/migrate/v2",
  },
  {
    id: "FOLD",
    source: "/strands/ag-ui",
    destination: "/strands/backend/ag-ui",
  },
  {
    id: "FOLD",
    source: "/strands/copilot-runtime",
    destination: "/strands/backend/copilot-runtime",
  },
  {
    id: "FOLD",
    source: "/strands/deploy-agentcore",
    destination: "/strands/deploy/agentcore",
  },
  {
    id: "FOLD",
    source: "/strands/generative-ui/your-components/display-only",
    destination: "/strands/generative-ui/display",
  },
  {
    id: "FOLD",
    source: "/strands/generative-ui/your-components/interactive",
    destination: "/strands/generative-ui/interactive",
  },
  {
    id: "FOLD",
    source: "/strands/shared-state/in-app-agent-read",
    destination: "/strands/shared-state",
  },
  {
    id: "FOLD",
    source: "/strands/shared-state/in-app-agent-write",
    destination: "/strands/shared-state",
  },
  {
    id: "FOLD",
    source: "/strands/troubleshooting/migrate-to-1.10.X",
    destination: "/strands/migrate/1.10.X",
  },
  {
    id: "FOLD",
    source: "/strands/troubleshooting/migrate-to-1.8.2",
    destination: "/strands/migrate/1.8.2",
  },
  {
    id: "FOLD",
    source: "/strands/troubleshooting/migrate-to-v2",
    destination: "/strands/migrate/v2",
  },
];
