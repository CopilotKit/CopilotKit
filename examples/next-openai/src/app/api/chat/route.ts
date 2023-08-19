import { OpenAIStream, StreamingTextResponse } from "ai";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

export async function POST(req: Request) {
  const { messages, copilotkit_manually_passed_function_descriptions } =
    await req.json();

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    stream: true,
    messages,
    functions: copilotkit_manually_passed_function_descriptions,
  });

  const stream = OpenAIStream(response, {
    experimental_onFunctionCall: async (
      { name, arguments: args },
      createFunctionCallMessages
    ) => {
      return undefined; // returning undefined to avoid sending any messages to the client when a function is called. Temporary, bc currently vercel ai sdk does not support returning both text and function calls -- although the API does support it.
    },
  });

  return new StreamingTextResponse(stream);
}
