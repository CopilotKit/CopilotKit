import { CopilotKitBackend } from "@copilotkit/cloud";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  try {
    const copilotKit = new CopilotKitBackend({
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

    return new Response(copilotKit.stream(await req.json()));
  } catch (error) {
    return new Response("", { status: 500, statusText: error.error.message });
  }
}
