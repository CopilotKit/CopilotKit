import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const { messages, ...otherProps } = await req.json();

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    stream: false,
    messages,
    max_tokens: 50,
    stop: [".", "?", "!"],
    ...otherProps,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
    },
  });
}
