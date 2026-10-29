import { createCopilotRuntimeHandler as createCopilotHonoHandler } from "@copilotkit/runtime";
import { createCopilotRuntimeHandler as createCopilotEndpointSingleRoute } from "@copilotkit/runtime";
const createCopilotRuntimeHandler = unrelated;
const multi = createCopilotHonoHandler({ cors: true, runtime, basePath: "/api" });
const single = createCopilotEndpointSingleRoute({ cors: true, mode: "single-route", runtime, basePath: "/rpc" });
export const get = (req: Request) => multi(req);
export const post = (req: Request) => single(req);
