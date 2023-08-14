import { Configuration, OpenAIApi } from "openai-edge";
import { OpenAIStream, StreamingTextResponse } from "ai";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const { messages } = await req.json();

  const response = await openai.createChatCompletion({
    model: "gpt-4",
    max_tokens: 500,
    messages,
  });

  return response;
}
