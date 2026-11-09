import {
  createCopilotEndpoint,
  createCopilotEndpointSingleRoute,
} from "@copilotkit/runtime/v2";
import {
  createCatalogOnlyRuntime,
  createDefaultRuntime,
  createGenerativeUIRuntime,
  createMcpRuntime,
} from "./runtime";

const defaultRuntime = createDefaultRuntime();
const singleRuntime = createDefaultRuntime();
const mcpRuntime = createMcpRuntime();
const catalogOnlyRuntime = createCatalogOnlyRuntime();
const generativeUIRuntime = createGenerativeUIRuntime();

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

export const copilotGenerativeUIEndpoint = createCopilotEndpoint({
  runtime: generativeUIRuntime,
  basePath: "/api/copilotkit-generative-ui",
});
