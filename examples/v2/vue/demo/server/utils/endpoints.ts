import {
  createCopilotEndpoint,
  createCopilotEndpointSingleRoute,
} from "@copilotkit/runtime/v2";
import { createDefaultRuntime, createMcpRuntime } from "./runtime";

const defaultRuntime = createDefaultRuntime();
const singleRuntime = createDefaultRuntime();
const mcpRuntime = createMcpRuntime();

export const copilotEndpoint = createCopilotEndpoint({
  runtime: defaultRuntime,
  basePath: "/api/copilotkit",
});

export const copilotSingleEndpoint = createCopilotEndpointSingleRoute({
  runtime: singleRuntime,
  basePath: "/api/copilotkit-single",
});

export const copilotMcpEndpoint = createCopilotEndpoint({
  runtime: mcpRuntime,
  basePath: "/api/copilotkit-mcp",
});
