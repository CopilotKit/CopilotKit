import { CopilotRuntime } from "@copilotkit/backend";
import { OllamaAdapter } from "../../../../../../../packages/backend/src/lib/ollama-adapter"

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime();

  return copilotKit.response(req, new OllamaAdapter({ model : "llama3:latest" }));
}
