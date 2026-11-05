// TODO(copilotkit-2.0): `MCPClientConfig` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/integrations/built-in-agent/mcp-servers
// TODO(copilotkit-2.0): `MCPClientConfig`: Create each MCP client with `createMCPClient` from "@tanstack/ai-mcp" and pass the clients in `mcpClients`.
import {
  BuiltInAgent,
} from "@copilotkit/runtime/agent";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  type MCPClientConfig,
} from "@copilotkit/runtime";
// TODO(copilotkit-2.0): `resolveModel` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent
// TODO(copilotkit-2.0): `resolveModel`: Model strings were removed. Pass a TanStack AI text adapter such as `openaiText("gpt-5")` from "@tanstack/ai-openai" as `model`. To handle a model name forwarded from the client, set the `resolveModel` option of the `BuiltInAgent` config.
// TODO(copilotkit-2.0): `classifyModelSpec` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent
// TODO(copilotkit-2.0): `classifyModelSpec`: Model strings were removed. Pass a TanStack AI text adapter such as `openaiText("gpt-5")` from "@tanstack/ai-openai" as `model`. To handle a model name forwarded from the client, set the `resolveModel` option of the `BuiltInAgent` config.
import { resolveModel, classifyModelSpec } from "@copilotkit/runtime";
import { createAnthropicChat, anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";
import { vertexText } from "@tanstack/ai-vertex";

const modelName = process.env.MODEL ?? "openai/gpt-5";
const servers: MCPClientConfig[] = [];

export const runtime = new CopilotRuntime({
  agents: {
    openai: new BuiltInAgent({ model: openaiText("gpt-5") }),
    openaiColon: new BuiltInAgent({ model: openaiText("gpt-4o") }),
    anthropic: new BuiltInAgent({ model: anthropicText("claude-sonnet-4-5") }),
    explicitKey: new BuiltInAgent({
      model: createAnthropicChat("claude-sonnet-4-5", "sk-test"),
    }),
    google: new BuiltInAgent({ model: geminiText("gemini-2.5-pro") }),
    gemini: new BuiltInAgent({ model: geminiText('gemini-2.5-flash') }),
    googleGemini: new BuiltInAgent({ model: geminiText("gemini-2.5-pro") }),
    adapter: new BuiltInAgent({ model: geminiText("gemini-2.5-flash") }),
    vertex: new BuiltInAgent({ model: vertexText("gemini-2.5-pro") }),
    minimax: new BuiltInAgent({ /* TODO(copilotkit-2.0): `model` must be a TanStack AI text adapter in 2.0, such as `openaiText("gpt-5")` from "@tanstack/ai-openai". Model strings are not supported, so replace this value if it is one. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ model: "minimax/MiniMax-M3" }),
    fromEnv: new BuiltInAgent({ /* TODO(copilotkit-2.0): `model` must be a TanStack AI text adapter in 2.0, such as `openaiText("gpt-5")` from "@tanstack/ai-openai". Model strings are not supported, so replace this value if it is one. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ model: modelName }),
    withKey: new BuiltInAgent({
      model: openaiText("gpt-5"),
      /* TODO(copilotkit-2.0): `apiKey` was removed in 2.0. The adapter reads its key from the environment, or pass it to the adapter (for example `createOpenaiChat(model, apiKey)`). See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ apiKey: process.env.OPENAI_API_KEY,
    }),
    mcp: new BuiltInAgent({
      model: openaiText("gpt-5"),
      /* TODO(copilotkit-2.0): `mcpServers` was removed in 2.0. Create each MCP client with `createMCPClient` from "@tanstack/ai-mcp" and pass the clients in `mcpClients`. See https://docs.copilotkit.ai/integrations/built-in-agent/mcp-servers */ mcpServers: servers,
    }),
  },
});

export const handler = createCopilotRuntimeHandler({ runtime });
export const resolved = resolveModel("openai/gpt-5");
export const host = classifyModelSpec("openai/gpt-5");
