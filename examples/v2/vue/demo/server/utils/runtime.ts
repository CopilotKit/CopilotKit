import { BasicAgent } from "@copilotkitnext/agent";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { CopilotRuntime, InMemoryAgentRunner } from "@copilotkitnext/runtime";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-4o";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-sonnet-4.5";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-4o";
};

const createTranscriptionService = () => {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return undefined;
  }
  return new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });
};

export const createDefaultRuntime = () =>
  new CopilotRuntime({
    agents: {
      default: new BasicAgent({
        model: determineModel(),
        prompt: "You are a helpful AI assistant.",
        temperature: 0.7,
      }),
    },
    runner: new InMemoryAgentRunner(),
    transcriptionService: createTranscriptionService(),
  });

export const createMcpRuntime = () => {
  const agent = new BasicAgent({
    model: determineModel(),
    prompt: "You are a helpful AI assistant with access to MCP apps and tools.",
    temperature: 0.7,
  }).use(
    new MCPAppsMiddleware({
      mcpServers: [
        { type: "http", url: "http://localhost:3101/mcp" },
        { type: "http", url: "http://localhost:3102/mcp" },
        { type: "http", url: "http://localhost:3103/mcp" },
        { type: "http", url: "http://localhost:3104/mcp" },
        { type: "http", url: "http://localhost:3105/mcp" },
        { type: "http", url: "http://localhost:3106/mcp" },
        { type: "http", url: "http://localhost:3107/mcp" },
        { type: "http", url: "http://localhost:3108/mcp" },
        { type: "http", url: "http://localhost:3109/mcp" },
        { type: "http", url: "http://localhost:3110/mcp" },
        { type: "http", url: "http://localhost:3111/mcp" },
        { type: "http", url: "http://localhost:3112/mcp" },
      ],
    }),
  );

  return new CopilotRuntime({
    agents: { default: agent },
    runner: new InMemoryAgentRunner(),
  });
};
