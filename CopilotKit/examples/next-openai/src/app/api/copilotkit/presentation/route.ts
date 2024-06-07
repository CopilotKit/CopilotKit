import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
import { researchWithLangGraph } from "./research";
import { Action } from "@copilotkit/shared";

export const runtime = "edge";

const researchAction = {
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
    return await researchWithLangGraph(topic);
  },
};

export async function POST(req: Request): Promise<Response> {
  const env = process.env;
  const actions: Action<any>[] = [];
  if (env["TAVILY_API_KEY"]) {
    actions.push(researchAction);
  }
  const copilotKit = new CopilotRuntime({
    actions: actions,
  });

  return copilotKit.response(req, new OpenAIAdapter());
}
