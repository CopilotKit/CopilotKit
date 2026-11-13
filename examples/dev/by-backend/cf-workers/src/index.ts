import {
  CopilotRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { createOpenaiChat } from "@tanstack/ai-openai";

export interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtime = new CopilotRuntime({
      agents: {
        default: new BuiltInAgent({
          model: createOpenaiChat("gpt-6-luna", env.OPENAI_API_KEY),
        }),
      },
    });

    const handler = createCopilotKitRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
      cors: true,
    });

    return handler(request);
  },
};
