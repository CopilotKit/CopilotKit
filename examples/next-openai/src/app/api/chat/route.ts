import { Configuration, OpenAIApi } from "openai-edge";
import { OpenAIStream, StreamingTextResponse } from "ai";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

export const runtime = "edge";

export async function POST(req: Request) {
  const {
    messages,
    function_call,
    copilotkit_manually_passed_function_descriptions,
  } = await req.json();

  const response = await openai.createChatCompletion({
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
      // createFunctionCallMessages({})
      return undefined;
    },
  });

  return new StreamingTextResponse(stream);
}
