import http from "http";
import { CopilotBackend, OpenAIAdapter } from "@copilotkit/backend";

const HEADERS = {
  // make sure to modify CORS headers to match your frontend's origin
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer((request, response) => {
  try {
    const headers =
      request.method === "POST" ? { ...HEADERS, "Content-Type": "application/json" } : HEADERS;
    response.writeHead(200, headers);
    if (request.method == "POST") {
      const copilotKit = new CopilotBackend();
      console.log("streaming response");
      copilotKit.streamHttpServerResponse(request, response, new OpenAIAdapter({})).then(() => {
        console.log("streaming response done");
      });
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
