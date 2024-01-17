import { CopilotKit } from "@copilotkit/cloud";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  try {
    const copilotKit = new CopilotKit({
      functions: [
        {
          name: "doSomethingServerSide",
          description: "This tells GPT what to do.",
          argumentAnnotations: [
            {
              name: "arg",
              type: "string",
              description: "This explains GPT what the arg is.",
              required: true,
            },
          ],
          implementation: async (arg) => {
            console.log("doSomethingServerSide", arg);
          },
        },
      ],
    });

    return new Response(copilotKit.stream(req.json()));
  } catch (error) {
    return new Response("", { status: 500, statusText: error.error.message });
  }
}
