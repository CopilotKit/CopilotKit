import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";

export interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtime = new CopilotRuntime({
      agents: {
        // Workers get secrets from `env`, not from process.env.
        default: tanstackAIAgent({
          adapter: createOpenaiChat("gpt-5-mini", env.OPENAI_API_KEY),
        }),
      },
    });

    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
      cors: true,
    });

    return handler(request);
  },
};
