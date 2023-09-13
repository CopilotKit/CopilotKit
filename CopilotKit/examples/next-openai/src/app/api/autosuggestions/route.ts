import { OpenAIStream, StreamingTextResponse } from "ai";
import OpenAI from "openai";
import { CompletionCreateParamsStreaming } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const { messages, ...otherProps } = await req.json();

  const body: CompletionCreateParamsStreaming = {
    model: "gpt-4",
    messages,
    ...otherProps,
    stream: true,
  };

  const response = await openai.chat.completions.create(body);

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
