import { CopilotRuntime, createCopilotKitRuntimeHandler } from "@copilotkit/runtime";
import {
  createCopilotKitNodeHandler,
  createCopilotKitNodeListener,
} from "@copilotkit/runtime/node";

const runtime = new CopilotRuntime({ agents: {} });
export const handler = createCopilotKitRuntimeHandler({ runtime, basePath: "/api" });
export const nodeHandler = createCopilotKitNodeHandler(handler);
export const listener = createCopilotKitNodeListener({ runtime, basePath: "/api" });
