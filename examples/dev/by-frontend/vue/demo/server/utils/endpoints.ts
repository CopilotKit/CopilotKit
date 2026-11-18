import { createCopilotKitRuntimeHandler } from "@copilotkit/runtime";
import {
  createCatalogOnlyRuntime,
  createDefaultRuntime,
  createGenerativeUIRuntime,
  createMcpRuntime,
  createStandardCatalogRuntime,
} from "./runtime";

const defaultRuntime = createDefaultRuntime();
const singleRuntime = createDefaultRuntime();
const mcpRuntime = createMcpRuntime();
const catalogOnlyRuntime = createCatalogOnlyRuntime();
const generativeUIRuntime = createGenerativeUIRuntime();
const standardCatalogRuntime = createStandardCatalogRuntime();

export const copilotEndpoint = createCopilotKitRuntimeHandler({
  cors: true,
  runtime: defaultRuntime,
  basePath: "/api/copilotkit",
});

export const copilotSingleEndpoint = createCopilotKitRuntimeHandler({
  mode: "single-route",
  cors: true,
  runtime: singleRuntime,
  basePath: "/api/copilotkit-single",
});

export const copilotMcpEndpoint = createCopilotKitRuntimeHandler({
  cors: true,
  runtime: mcpRuntime,
  basePath: "/api/copilotkit-mcp",
});

export const copilotCatalogEndpoint = createCopilotKitRuntimeHandler({
  cors: true,
  runtime: catalogOnlyRuntime,
  basePath: "/api/copilotkit-catalog",
});

export const copilotGenerativeUIEndpoint = createCopilotKitRuntimeHandler({
  cors: true,
  runtime: generativeUIRuntime,
  basePath: "/api/copilotkit-generative-ui",
});

export const copilotStandardCatalogEndpoint = createCopilotKitRuntimeHandler({
  cors: true,
  runtime: standardCatalogRuntime,
  basePath: "/api/copilotkit-generative-ui-standard",
});
