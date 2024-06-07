import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
import { research } from "./tavily";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const actions: any[] = [];

  if ("TAVILY_API_KEY" in process.env) {
    actions.push({
      name: "research",
      description:
        "Call this function to conduct research on a certain topic. Respect other notes about when to call this function",
      parameters: [
        {
          name: "topic",
          type: "string",
          description: "The topic to research. 5 characters or longer.",
        },
      ],
      handler: async ({ topic }) => {
        console.log("Researching topic: ", topic);
        return await research(topic);
      },
    });
  }
  const copilotKit = new CopilotRuntime({
    actions: actions,
  });

  return copilotKit.response(req, new OpenAIAdapter());
}
