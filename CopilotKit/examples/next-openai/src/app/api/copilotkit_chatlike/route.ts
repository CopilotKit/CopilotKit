import { OpenAIStream, StreamingTextResponse } from "ai";
import OpenAI from "openai";
import { CompletionCreateParamsStreaming } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const forwardedProps = await req.json();

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    ...forwardedProps,
    stream: true,
  } as CompletionCreateParamsStreaming);

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
