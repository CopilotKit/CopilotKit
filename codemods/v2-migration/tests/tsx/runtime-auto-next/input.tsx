import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
const runtime = new CopilotRuntime({ agents: {} });
const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
export const GET = handle(app);
export const POST = handle(app);
