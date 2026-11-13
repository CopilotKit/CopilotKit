import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime";
import {
  createCopilotNodeHandler,
  createCopilotNodeListener,
} from "@copilotkit/runtime/node";

const runtime = new CopilotRuntime({ agents: {} });
export const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api" });
export const nodeHandler = createCopilotNodeHandler(handler);
export const listener = createCopilotNodeListener({ runtime, basePath: "/api" });
