import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
import type { ActionFunctionArgs } from "@remix-run/node";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const copilotKit = new CopilotRuntime();
  return copilotKit.response(request, new OpenAIAdapter({}));
}
