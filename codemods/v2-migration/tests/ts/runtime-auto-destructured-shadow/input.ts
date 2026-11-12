import { createCopilotHonoHandler as create } from "@copilotkit/runtime/hono";
const endpoint = create({ runtime, basePath: "/api" });
endpoint.fetch(request);
function shadow() {
  const { create } = otherLibrary;
  const local = create({ runtime, basePath: "/local" });
  local.fetch(request);
}
