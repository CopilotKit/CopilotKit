import { handle as wrap } from "hono/vercel";
import { createCopilotRuntimeHandler } from "@copilotkit/runtime";
const app = createCopilotRuntimeHandler({ cors: true, runtime, basePath: "/api" });
export const GET = app;
export const otherGET = wrap(otherApp);
