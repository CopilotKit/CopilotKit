import { createCopilotRuntimeHandler } from "@copilotkit/runtime";
import { createCopilotRuntimeHandler as createCopilotEndpointSingleRoute } from "@copilotkit/runtime";
const multi = createCopilotRuntimeHandler({ cors: true, runtime, basePath: "/api" });
const single = createCopilotEndpointSingleRoute({ cors: true, mode: "single-route", runtime, basePath: "/rpc" });
export const GET = (req: Request) => multi(req);
export const POST = (req: Request) => single(req);
