import {
  createCopilotKitRuntimeHandler as createCopilotHonoHandler,
  createCopilotKitRuntimeHandler as createCopilotEndpointSingleRoute,
} from "@copilotkit/runtime";
const createCopilotKitRuntimeHandler = unrelated;
const multi = createCopilotHonoHandler({ cors: true, runtime, basePath: "/api" });
const single = createCopilotEndpointSingleRoute({ cors: true, mode: "single-route", runtime, basePath: "/rpc" });
export const get = (req: Request) => multi(req);
export const post = (req: Request) => single(req);
