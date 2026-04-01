import { createHonoServer } from "react-router-hono-server/node";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  Agent,
} from "@copilotkit/runtime/v2";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

export default await createHonoServer({
  configure(app) {
    const agent = new Agent({
      type: "tanstack",
      factory: ({ input, abortController }) => {
        const messages = input.messages
          .filter((m) => m.role !== "developer" && m.role !== "system")
          .map((m) => ({
            role: m.role as "user" | "assistant" | "tool",
            content: typeof m.content === "string" ? m.content : null,
          }));

        const systemPrompts: string[] = [];
        for (const m of input.messages) {
          if ((m.role === "system" || m.role === "developer") && m.content) {
            systemPrompts.push(
              typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content),
            );
          }
        }

        if (input.context?.length) {
          for (const ctx of input.context) {
            systemPrompts.push(`${ctx.description}:\n${ctx.value}`);
          }
        }

        if (input.state && Object.keys(input.state).length > 0) {
          systemPrompts.push(
            `Application State:\n\`\`\`json\n${JSON.stringify(input.state, null, 2)}\n\`\`\``,
          );
        }

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
