import express from "express";
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/backend";

const port = 4000;
var HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, PATCH, DELETE",
  "Access-Control-Allow-Headers": "X-Requested-With,content-type",
};

const app = express();

app.use("/", (req, res, next) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, HEADERS);
    res.end();
    return;
  }
  var copilotKit = new CopilotRuntime();
  copilotKit.streamHttpServerResponse(req, res, new OpenAIAdapter(), HEADERS);
});

app.listen(port, () => {
  console.log("Listening at http://localhost:4000/copilotkit");
});
