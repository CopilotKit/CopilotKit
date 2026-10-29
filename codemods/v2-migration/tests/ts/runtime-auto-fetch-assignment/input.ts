import { createCopilotEndpoint } from "@copilotkit/runtime/v2";
const app = createCopilotEndpoint({ runtime, basePath: "/api" });
app.fetch = patched;
