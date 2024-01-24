import { CopilotBackend, OpenAIAdapter } from "@copilotkit/backend";

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

  return copilotKit.response(req, new OpenAIAdapter({}));
}
