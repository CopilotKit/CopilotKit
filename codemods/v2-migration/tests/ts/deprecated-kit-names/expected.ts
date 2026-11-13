import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
  type CopilotKitRuntimeOptions,
  type CopilotKitCorsConfig as Cors,
} from "@copilotkit/runtime";
import {
  createCopilotKitNodeHandler,
  createCopilotKitNodeListener,
  type NodeCopilotKitListener,
} from "@copilotkit/runtime/node";

const options: CopilotKitRuntimeOptions = { agents: {} };
const cors: Cors = { origin: "https://example.com" };
const runtime = new CopilotKitRuntime(options);
export const handler = createCopilotKitRuntimeHandler({ runtime, basePath: "/api", cors });
export const nodeHandler = createCopilotKitNodeHandler(handler);
export const listener: NodeCopilotKitListener = createCopilotKitNodeListener({ runtime, basePath: "/api" });
