import { createCopilotExpressHandler } from "@copilotkit/runtime/express";
const app = someOtherFramework();
app.use(createCopilotExpressHandler({ runtime, basePath: "/api" }));
