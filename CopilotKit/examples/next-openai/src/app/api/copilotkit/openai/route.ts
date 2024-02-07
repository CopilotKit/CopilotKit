import { CopilotBackend, OpenAIAdapter } from "@copilotkit/backend";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotBackend({
    actions: [
      {
        name: "sayHello",
        description: "Says hello to someone.",
        argumentAnnotations: [
          {
            name: "name",
            type: "string",
            description: "The name of the person to say hello to.",
            required: true,
          },
        ],
        implementation: async (name) => {
          const prompt = ChatPromptTemplate.fromMessages([
            [
              "system",
              "The user tells you their name. Say hello to the person in the most " +
                " ridiculous way, roasting their name.",
            ],
            ["user", "My name is {name}"],
          ]);
          const chain = prompt.pipe(new ChatOpenAI());
          return chain.invoke({
            name: name,
          });
        },
      },
    ],
    langserve: [
      {
        chainUrl: "http://localhost:8000/retriever",
        name: "askTheRetriever",
        description:
          "Ask the agent about something. Call this function when the user specifically wants to ask the retriever something.",
      },
      {
        chainUrl: "http://localhost:8000/agent",
        name: "askAboutEugeneThoughts",
        description:
          "Ask what Eugene thinks about something. Call this function when the user specifically wants to ask Eugene something.",
      },
    ],
  });

  return copilotKit.response(req, new OpenAIAdapter());
}
