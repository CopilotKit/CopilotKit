import { CopilotRuntime } from "@copilotkit/runtime";
import { createCopilotRuntimeHandler } from "@copilotkit/runtime";

const runtime = new CopilotRuntime({ agents: {} });
const app = createCopilotRuntimeHandler({ cors: true, runtime, basePath: "/api/copilotkit" });
export const GET = app;
export const POST = app;
