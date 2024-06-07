import { CopilotRuntime } from "@copilotkit/backend";
import { GroqAdapter } from "../../../../../../../packages/backend/src/lib/groq-adapter"

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime();

  return copilotKit.response(req, new GroqAdapter({ model : "llama3-70b-8192" }));
}
