import * as runtime from "@copilotkit/runtime";
import * as node from "@copilotkit/runtime/node";
import legacy = require("@copilotkit/runtime");
import type * as app from "./app-types";
import type { CopilotRuntimeOptions } from "@copilotkit/runtime";

const options: runtime.CopilotRuntimeOptions = { agents: {} };
const shared: CopilotRuntimeOptions = options;
const instance = new runtime.CopilotRuntime(shared);
export const handler = runtime.createCopilotRuntimeHandler({ runtime: instance, basePath: "/api" });
export const listener: node.NodeCopilotListener = node.createCopilotNodeListener({ runtime: instance, basePath: "/api" });
export type RuntimeClass = typeof runtime.CopilotRuntime;
export const sse = new legacy.CopilotSseRuntime({ agents: {} });
export const runner = new runtime.InMemoryAgentRunner();
export type AppOptions = app.CopilotRuntimeOptions;
