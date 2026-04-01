import { createHonoServer } from "react-router-hono-server/node";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  Agent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

export default await createHonoServer({
  configure(app) {
    const agent = new Agent({
      type: "tanstack",
      factory: ({ input, abortController }) => {
        const { messages, systemPrompts } = convertInputToTanStackAI(input);

        return chat({
          adapter: openaiText("gpt-4o"),
          messages,
          systemPrompts,
          abortController,
        });
      },
    });

    const builtinAgent = new BuiltInAgent({
      model: "openai/gpt-4o",
      prompt:
        "You are a helpful assistant. When the user sends images or files, describe what you see or analyze the content.",
    });

    const runtime = new CopilotRuntime({
      agents: {
        tanstack: agent,
        builtin: builtinAgent,
      },
      runner: new InMemoryAgentRunner(),
    });

    const copilotEndpoint = createCopilotEndpoint({
      runtime,
      basePath: "/api/copilotkit",
    });

    app.route("/", copilotEndpoint);
  },
});
