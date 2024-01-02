import { OpenAIStream, StreamingTextResponse } from "ai";
import Portkey from "portkey-ai";

const portkey = new Portkey({
  apiKey: process.env.PORTKEY_API_KEY,       // Get from https://app.portkey.ai/
  /*****************************/  
  provider: 'openai',                        // Change to 'azure-openai', 'anthropic', 'google-palm', 'anyscale' etc.
  Authorization: process.env.OPENAI_API_KEY, // Pass the Bearer auth key for the chosen provider
  /*****************************/
});

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const forwardedProps = await req.json();

  const portkeyResponse = await portkey.chat.completions.create({
    model: "gpt-4",
    ...forwardedProps,
    stream: true,
  });

  const jsonResponseString = JSON.stringify(portkeyResponse);

  const response = new Response(jsonResponseString, {
    headers: { 'Content-Type': 'application/json' }
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