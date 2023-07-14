import { Configuration, OpenAIApi } from "openai-edge";
import { OpenAIStream, StreamingTextResponse } from "ai";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

export const runtime = "edge";

export async function POST(req: Request) {
  const { messages, function_call, functions } = await req.json();

  const response = await openai.createChatCompletion({
    model: "gpt-4",
    stream: true,
    messages: messages.map((message: any) => ({
      content: message.content,
      role: message.role,
    })),
    functions,
    function_call,
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
