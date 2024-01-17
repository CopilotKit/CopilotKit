import { CopilotKit } from "@copilotkit/cloud";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  try {
    const copilotKit = new CopilotKit();
    return new Response(copilotKit.stream(req.json()));
  } catch (error) {
    return new Response("", { status: 500, statusText: error.error.message });
  }
}
