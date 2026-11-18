// TODO(copilotkit-2.0): This import of "@copilotkit/runtime" can't be migrated automatically. Import the 2.0 APIs by name: https://docs.copilotkit.ai/migrate/v2
import * as runtime from "@copilotkit/runtime";
import * as node from "@copilotkit/runtime/node";
import legacy = require("@copilotkit/runtime");
import type * as app from "./app-types";
import type { CopilotKitRuntimeOptions } from "@copilotkit/runtime";

const options: runtime.CopilotKitRuntimeOptions = { agents: {} };
const shared: CopilotKitRuntimeOptions = options;
const instance = new runtime.CopilotKitRuntime(shared);
export const handler = runtime.createCopilotKitRuntimeHandler({ runtime: instance, basePath: "/api" });
export const listener: node.NodeCopilotKitListener = node.createCopilotKitNodeListener({ runtime: instance, basePath: "/api" });
export type RuntimeClass = typeof runtime.CopilotKitRuntime;
export const sse = new legacy.CopilotKitSseRuntime({ agents: {} });
export const runner = new runtime.InMemoryAgentRunner();
export type AppOptions = app.CopilotRuntimeOptions;
