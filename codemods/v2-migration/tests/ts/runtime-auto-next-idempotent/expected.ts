import {
  CopilotRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";

const runtime = new CopilotRuntime({ agents: {} });
const app = createCopilotKitRuntimeHandler({ cors: true, runtime, basePath: "/api/copilotkit" });
export const GET = app;
export const POST = app;
