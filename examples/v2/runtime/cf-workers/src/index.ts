import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

export interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtime = new CopilotRuntime({
      agents: {
        default: new BuiltInAgent({ model: "openai/gpt-5-mini" }),
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
