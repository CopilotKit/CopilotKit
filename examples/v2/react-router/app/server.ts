import { createHonoServer } from "react-router-hono-server/node";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { TanStackAIAgent } from "./agent";

export default await createHonoServer({
  configure(app) {
    const agent = new TanStackAIAgent(
      ({ messages, systemPrompts, abortController }) =>
        chat({
          adapter: openaiText("gpt-4o"),
          messages,
          systemPrompts,
          abortController,
        }),
    );

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
