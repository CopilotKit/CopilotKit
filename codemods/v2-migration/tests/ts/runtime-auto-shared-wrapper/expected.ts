import { handle as wrap } from "hono/vercel";
import { createCopilotKitRuntimeHandler } from "@copilotkit/runtime";
const app = createCopilotKitRuntimeHandler({ cors: true, runtime, basePath: "/api" });
export const GET = app;
export const otherGET = wrap(otherApp);
