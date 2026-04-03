import { createHonoServer } from "react-router-hono-server/node";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

export default await createHonoServer({
  configure(app) {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      prompt: "You are a helpful assistant. When the user sends images or files, describe what you see or analyze the content.",
    });

    const runtime = new CopilotRuntime({
      agents: { default: agent },
      runner: new InMemoryAgentRunner(),
    });

    const copilotEndpoint = createCopilotEndpoint({
      runtime,
      basePath: "/api/copilotkit",
    });

    app.route("/", copilotEndpoint);
  },
});
