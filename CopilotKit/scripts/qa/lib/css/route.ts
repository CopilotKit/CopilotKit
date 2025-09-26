import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime();
  // @ts-ignore
  return copilotKit.response(req, new OpenAIAdapter({}));
}
