import { createCopilotHonoHandler } from "@copilotkit/runtime/hono";
import { createCopilotEndpointSingleRoute } from "@copilotkit/runtime/v2";
const createCopilotRuntimeHandler = unrelated;
const multi = createCopilotHonoHandler({ runtime, basePath: "/api" });
const single = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
export const get = (req: Request) => multi.fetch(req);
export const post = (req: Request) => single.fetch(req);
