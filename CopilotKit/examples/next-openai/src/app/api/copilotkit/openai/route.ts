import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/backend";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime({
    // debug: true,
    // actions: [
    //   {
    //     name: "sayHello",
    //     description: "Says hello to someone.",
    //     parameters: [
    //       {
    //         name: "name",
    //         type: "string",
    //         description: "The name of the person to say hello to.",
    //         required: true,
    //       },
    //     ],
    //     handler: async ({ name }) => {
    //       const prompt = ChatPromptTemplate.fromMessages([
    //         [
    //           "system",
    //           "The user tells you their name. Say hello to the person in the most " +
    //             " ridiculous way, roasting their name.",
    //         ],
    //         ["user", "My name is {name}"],
    //       ]);
    //       const chain = prompt.pipe(new ChatOpenAI());
    //       return chain.invoke({
    //         name: name,
    //       });
    //     },
    //   },
    // ],
    // langserve: [
    //   {
    //     chainUrl: "http://localhost:8000/retriever",
    //     name: "askAboutAnimals",
    //     description: "Always call this function if the users asks about a certain animal.",
    //   },
    //   {
    //     chainUrl: "http://localhost:8000/agent",
    //     name: "askAboutEugeneThoughts",
    //     description:
    //       "Always call this function if the users asks about Eugene's thoughts on a certain topic.",
    //   },
    // ],
  });

  return copilotKit.response(req, new OpenAIAdapter({ model: "gpt-4o" }));
}
