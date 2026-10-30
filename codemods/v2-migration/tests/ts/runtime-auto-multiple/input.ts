import { createCopilotHonoHandler } from "@copilotkit/runtime/hono";
import { createCopilotEndpointSingleRoute } from "@copilotkit/runtime/v2";
const multi = createCopilotHonoHandler({ runtime, basePath: "/api" });
const single = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
export const GET = (req: Request) => multi.fetch(req);
export const POST = (req: Request) => single.fetch(req);
