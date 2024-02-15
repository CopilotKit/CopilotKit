import { CopilotBackend, OpenAIAdapter } from "@copilotkit/backend";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { researchWithLangGraph } from "./langgraph";
import { AnnotatedFunction } from "@copilotkit/shared";

export const runtime = "edge";

const sayHelloAction: AnnotatedFunction<any> = {
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
};

const researchAction: AnnotatedFunction<any> = {
  name: "research",
  description:
    "Call this function when the user requests research on a certain topic. After researching, make a presentation.",
  argumentAnnotations: [
    {
      name: "topic",
      type: "string",
      description: "The topic to research. 5 characters or longer.",
      required: true,
    },
  ],
  implementation: async (topic) => {
    return await researchWithLangGraph(topic);
  },
};

export async function POST(req: Request): Promise<Response> {
  const actions: AnnotatedFunction<any>[] = [sayHelloAction];
  if (process.env["TAVILY_API_KEY"]) {
    actions.push(researchAction);
  }
  const copilotKit = new CopilotBackend({
    actions: actions,
  });

  return copilotKit.response(req, new OpenAIAdapter());
}
