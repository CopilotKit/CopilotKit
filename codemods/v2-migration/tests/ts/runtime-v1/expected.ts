// TODO(copilotkit-2.0): `MCPClient` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/integrations/built-in-agent/mcp-servers
// TODO(copilotkit-2.0): `MCPClient`: `@copilotkit/runtime` no longer re-exports the MCP client types. Import them from `@tanstack/ai-mcp`.
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  MCPClient,
} from "@copilotkit/runtime";
import { openaiText } from "@tanstack/ai-openai";
import { BuiltInAgent } from "@copilotkit/runtime/agent";

const runtime = new CopilotRuntime({ agents: { default: new BuiltInAgent({ model: openaiText("gpt-6-luna") }) } });

export const POST = async (req: Request) => {
  const handleRequest = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
  });
  return handleRequest(req);
};
