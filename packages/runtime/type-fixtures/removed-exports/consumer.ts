/** A 1.x runtime that uses exports that CopilotKit 2.0 removed. */
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { CopilotServiceAdapter } from "@copilotkit/runtime";
import {
  convertToolsToVercelAITools,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";

// @ts-expect-error Use CopilotKitRuntime from @copilotkit/runtime
export const runtime = new CopilotRuntime();

// @ts-expect-error CopilotKit 2.0 has no service adapters
export const serviceAdapter = new OpenAIAdapter({ model: "gpt-5" });

// @ts-expect-error Serve the runtime with createCopilotKitRuntimeHandler
export const endpoint = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/api/copilotkit",
});

// A name that the deprecated /v2 alias lost.
// @ts-expect-error Use createCopilotKitRuntimeHandler from @copilotkit/runtime
export const app = createCopilotEndpoint({ runtime, basePath: "/api" });

// An AI SDK helper, which the /v2 alias does not export again.
// @ts-expect-error Import it from there, and add the ai package to your app
export const tools = convertToolsToVercelAITools([]);

// @ts-expect-error CopilotKit 2.0 has no service adapters
export const adapter: CopilotServiceAdapter = { process: async () => ({}) };
