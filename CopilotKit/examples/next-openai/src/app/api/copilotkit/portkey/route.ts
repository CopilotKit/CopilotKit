import { OpenAIStream, StreamingTextResponse } from "ai";
import OpenAI from "openai";
import { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const forwardedProps = await req.json();

  const response = await openai.chat.completions.create({
    model: "gpt-4-1106-preview",
    ...forwardedProps,
    stream: true,
  } as ChatCompletionCreateParamsStreaming);

  const stream = OpenAIStream(response, {
    experimental_onFunctionCall: async ({ name, arguments: args }, createFunctionCallMessages) => {
      return undefined; // returning undefined to avoid sending any messages to the client when a function is called. Temporary, bc currently vercel ai sdk does not support returning both text and function calls -- although the API does support it.
    },
  });

  return new StreamingTextResponse(stream);
}
