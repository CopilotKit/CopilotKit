import { handle as wrap } from "hono/vercel";
import { createCopilotEndpoint } from "@copilotkit/runtime";
const app = createCopilotEndpoint({ runtime, basePath: "/api" });
export const GET = wrap(app);
export const otherGET = wrap(otherApp);
