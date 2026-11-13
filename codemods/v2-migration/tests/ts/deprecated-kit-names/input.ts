import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  type CopilotRuntimeOptions,
  type CopilotCorsConfig as Cors,
} from "@copilotkit/runtime";
import {
  createCopilotNodeHandler,
  createCopilotNodeListener,
  type NodeCopilotListener,
} from "@copilotkit/runtime/node";

const options: CopilotRuntimeOptions = { agents: {} };
const cors: Cors = { origin: "https://example.com" };
const runtime = new CopilotRuntime(options);
export const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api", cors });
export const nodeHandler = createCopilotNodeHandler(handler);
export const listener: NodeCopilotListener = createCopilotNodeListener({ runtime, basePath: "/api" });
