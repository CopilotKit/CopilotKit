import * as http from "http";
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNodeHttpEndpoint } from "@copilotkit/runtime";

const port = 4000;
var HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, PATCH, DELETE",
  "Access-Control-Allow-Headers": "X-Requested-With,content-type",
};

const handler = copilotRuntimeNodeHttpEndpoint({
  endpoint: "/",
  runtime: new CopilotRuntime(),
  serviceAdapter: new OpenAIAdapter(),
});

var server = http.createServer(function (req, res) {
  // Respond to OPTIONS (preflight) request
  if (req.method === "OPTIONS") {
    res.writeHead(200, HEADERS);
    res.end();
    return;
  }

  return handler(req, res);
});
server.listen(port, function () {
  console.log(`Server running at http://localhost:${port}`);
});
