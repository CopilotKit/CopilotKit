import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime();
  return copilotKit.response(req, new OpenAIAdapter({}));
}
