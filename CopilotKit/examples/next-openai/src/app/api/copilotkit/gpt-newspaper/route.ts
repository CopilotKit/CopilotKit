import { CopilotBackend, OpenAIAdapter } from "@copilotkit/backend";

// -----------------
// To run this example:
// - clone https://github.com/mme/gpt-newspaper
// - follow the instructions in NOTES.md
// -----------------

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotBackend({
    actions: [
      {
        name: "research",
        description:
          "Call this function when the user requests research on a certain topic. After researching, make a presentation.",
        argumentAnnotations: [
          {
            name: "topic",
            type: "string",
            description: "The topic to research.",
            required: true,
          },
        ],
        implementation: async (topic) => {
          const response = await fetch("http://localhost:8000/generate_newspaper_html", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              topics: [topic],
              layout: "layout_1.html",
            }),
          });

          // return the html from the newspaper generator
          return await response.text();
        },
      },
    ],
  });

  return copilotKit.response(req, new OpenAIAdapter());
}
