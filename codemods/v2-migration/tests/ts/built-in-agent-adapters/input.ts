import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  type MCPClientConfig,
} from "@copilotkit/runtime";
import { resolveModel, classifyModelSpec } from "@copilotkit/runtime/v2";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";

const modelName = process.env.MODEL ?? "openai/gpt-5";
const servers: MCPClientConfig[] = [];
const maxRetries = 2;

export const runtime = new CopilotRuntime({
  agents: {
    openai: new BuiltInAgent({ model: "openai/gpt-5" }),
    openaiColon: new BuiltInAgent({ model: "openai:gpt-4o" }),
    anthropic: new BuiltInAgent({ model: "anthropic/claude-sonnet-4-5" }),
    explicitKey: new BuiltInAgent({
      model: createAnthropicChat("claude-sonnet-4-5", "sk-test"),
    }),
    google: new BuiltInAgent({ model: "google/gemini-2.5-pro" }),
    gemini: new BuiltInAgent({ model: 'gemini:gemini-2.5-flash' }),
    googleGemini: new BuiltInAgent({ model: "google-gemini/gemini-2.5-pro" }),
    adapter: new BuiltInAgent({ model: geminiText("gemini-2.5-flash") }),
    vertex: new BuiltInAgent({ model: "vertex/gemini-2.5-pro" }),
    minimax: new BuiltInAgent({ model: "minimax/MiniMax-M3" }),
    fromEnv: new BuiltInAgent({ model: modelName }),
    withKey: new BuiltInAgent({
      model: "openai/gpt-5",
      apiKey: process.env.OPENAI_API_KEY,
    }),
    mcp: new BuiltInAgent({
      model: "openai/gpt-5",
      mcpServers: servers,
    }),
    retryLiteral: new BuiltInAgent({
      model: "openai/gpt-5",
      maxRetries: 3,
      temperature: 0.2,
    }),
    retryExpression: new BuiltInAgent({
      model: "openai/gpt-5",
      maxRetries: Number(process.env.MAX_RETRIES ?? 2),
    }),
    retryShorthand: new BuiltInAgent({ model: "openai/gpt-5", maxRetries }),
  },
});

export const handler = createCopilotRuntimeHandler({ runtime });
export const resolved = resolveModel("openai/gpt-5");
export const host = classifyModelSpec("openai/gpt-5");
