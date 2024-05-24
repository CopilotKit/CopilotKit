import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/backend";
import { research } from "./tavily";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime({
    actions: [
      {
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
      },
    ],
  });

  return copilotKit.response(req, new OpenAIAdapter());
}
