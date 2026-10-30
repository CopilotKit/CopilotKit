import { createCopilotEndpoint } from "@copilotkit/runtime/v2";
const app = createCopilotEndpoint({ ...options, runtime, basePath: "/api" });
app.fetch(request);
