import { BasicAgent, CopilotRuntime } from "@copilotkit/runtime/v2";
import type { BasicAgentConfiguration as AgentConfig } from "@copilotkit/runtime";
import type { CopilotKitRequestHandler } from "@copilotkit/runtime";
import { createNodeFetchHandler } from "@copilotkit/runtime/node";
import { createA2UICatalog, useA2UIStore } from "@copilotkit/a2ui-renderer";
import type { ImageData } from "@copilotkit/shared";

const config: AgentConfig = { model: "openai/gpt-5" };
export const agent = new BasicAgent(config);
export const runtime = new CopilotRuntime({ agents: { default: agent } });
export const listener = createNodeFetchHandler(async () => new Response());
export const store = useA2UIStore;
export const catalog = createA2UICatalog;
export type Handler = CopilotKitRequestHandler;
export type Image = ImageData;
