import { OpenAI } from "openai";

export const runtime = "edge";

const openai = new OpenAI();

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const text = url.searchParams.get("text"); // 'text' is the query parameter name

  if (!text) {
    return new Response("Text parameter is missing", { status: 400 });
  }

  const response = await openai.audio.speech.create({
    voice: "alloy",
    input: text,
    model: "tts-1",
  });

  return response;
}
