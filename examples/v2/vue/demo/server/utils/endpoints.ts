import { createCopilotRuntimeHandler } from "@copilotkit/runtime";
import {
  createCatalogOnlyRuntime,
  createDefaultRuntime,
  createMcpRuntime,
} from "./runtime";

const defaultRuntime = createDefaultRuntime();
const singleRuntime = createDefaultRuntime();
const mcpRuntime = createMcpRuntime();
const catalogOnlyRuntime = createCatalogOnlyRuntime();

export const copilotEndpoint = createCopilotRuntimeHandler({
  cors: true,
  runtime: defaultRuntime,
  basePath: "/api/copilotkit",
});

export const copilotSingleEndpoint = createCopilotRuntimeHandler({
  mode: "single-route",
  cors: true,
  runtime: singleRuntime,
  basePath: "/api/copilotkit-single",
});

export const copilotMcpEndpoint = createCopilotRuntimeHandler({
  cors: true,
  runtime: mcpRuntime,
  basePath: "/api/copilotkit-mcp",
});

export const copilotCatalogEndpoint = createCopilotRuntimeHandler({
  cors: true,
  runtime: catalogOnlyRuntime,
  basePath: "/api/copilotkit-catalog",
});
