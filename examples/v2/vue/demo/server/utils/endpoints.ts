import {
  createCopilotEndpoint,
  createCopilotEndpointSingleRoute,
} from "@copilotkit/runtime/v2";
import {
  createCatalogOnlyRuntime,
  createDefaultRuntime,
  createMcpRuntime,
} from "./runtime";

const defaultRuntime = createDefaultRuntime();
const singleRuntime = createDefaultRuntime();
const mcpRuntime = createMcpRuntime();
const catalogOnlyRuntime = createCatalogOnlyRuntime();

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

export const copilotCatalogEndpoint = createCopilotEndpoint({
  runtime: catalogOnlyRuntime,
  basePath: "/api/copilotkit-catalog",
});
