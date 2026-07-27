// @region[runtime-server]
import { createServer } from "node:http";
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-5-mini" }),
  },
});

const handler = createCopilotNodeHandler(
  createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  }),
);

createServer(handler).listen(4000);
// @endregion[runtime-server]
