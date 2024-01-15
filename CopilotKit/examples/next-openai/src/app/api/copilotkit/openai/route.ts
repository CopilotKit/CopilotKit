import OpenAI from "openai";
import { limitOpenAIMessagesToTokenCount, maxTokensForOpenAIModel } from "@copilotkit/cloud";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export async function POST(req: Request): Promise<Response> {
  try {
    const forwardedProps = await req.json();
    const messages = limitOpenAIMessagesToTokenCount(
      forwardedProps.messages || [],
      forwardedProps.functions || [],
      maxTokensForOpenAIModel(forwardedProps.model || DEFAULT_MODEL),
    );

    const stream = openai.beta.chat.completions
      .stream({
        model: DEFAULT_MODEL,
        ...forwardedProps,
        stream: true,
        messages,
      })
      .toReadableStream();

    return new Response(stream);
  } catch (error) {
    return new Response("", { status: 500, statusText: error.error.message });
  }
}
