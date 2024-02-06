import { CopilotBackend, LangChainAdapter } from "@copilotkit/backend";

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotBackend({
    functions: [
      {
        name: "sayHello",
        description: "Says hello to someone.",
        argumentAnnotations: [
          {
            name: "arg",
            type: "string",
            description: "The name of the person to say hello to.",
            required: true,
          },
        ],
        implementation: async (arg) => {
          console.log("Hello from the server", arg, "!");
        },
      },
    ],
  });

  return copilotKit.response(
    req,
    new LangChainAdapter(async (forwardedProps) => {
      const model = new ChatOpenAI({ modelName: "gpt-4-1106-preview" });
      return model.stream(forwardedProps.messages, { tools: forwardedProps.tools });
    }),
  );
}
