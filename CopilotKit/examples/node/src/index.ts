import http from "http";
import { CopilotRuntime, OpenAIAdapter, GoogleGenerativeAIAdapter } from "@copilotkit/backend";
import { GroqAdapter } from "../../../packages/backend/src/lib/groq-adapter"
import { OllamaAdapter } from "../../../packages/backend/src/lib/ollama-adapter"

const HEADERS = {
  // make sure to modify CORS headers to match your frontend's origin
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

process.env.OPENAI_API_KEY = "";

const server = http.createServer((request, response) => {
  try {
    const headers = {
      ...HEADERS,
      ...(request.method === "POST" && { "Content-Type": "application/json" }),
    };
    response.writeHead(200, headers);
    if (request.method == "POST") {
      const copilotKit = new CopilotRuntime();
      const provider = process.env.LLM_PROVIDER
      console.log(`>> provider: ${provider}`)
      const adapter = (!provider || provider === 'openai')?new OpenAIAdapter()
        :(provider === 'google')?new GoogleGenerativeAIAdapter()
        :(provider === 'groq')?new GroqAdapter()
        :(provider === 'ollama')?new OllamaAdapter()
        :null
      if (!adapter) {
        throw new Error(`unsupported provider; ${provider}`)
      }
      copilotKit.streamHttpServerResponse(request, response, adapter);
    } else {
      response.end("openai server");
    }
  } catch (err) {
    console.error(err);
    response.end("error");
  }
});

const port = 4201;
const host = "localhost";
server.listen(port, host);
console.log(`Listening at http://${host}:${port}`);
