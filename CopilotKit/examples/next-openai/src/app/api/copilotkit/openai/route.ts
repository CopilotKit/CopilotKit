import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(req: Request): Promise<Response> {
  try {
    const forwardedProps = await req.json();

    const stream = openai.beta.chat.completions
      .stream({
        model: "gpt-4-1106-preview",
        ...forwardedProps,
        stream: true,
      })
      .toReadableStream();

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response("", { status: 500, statusText: error.error.message });
  }
}
