var http = require("http");
var backend = require("@copilotkit/backend");
var port = 4000;
var HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, PATCH, DELETE",
  "Access-Control-Allow-Headers": "X-Requested-With,content-type",
};
var server = http.createServer(function (req, res) {
  console.log("got req with method: ".concat(req.method));
  // Respond to OPTIONS (preflight) request
  if (req.method === "OPTIONS") {
    res.writeHead(200, HEADERS);
    res.end();
    return;
  }
  var copilotKit = new backend.CopilotRuntime();
  copilotKit.streamHttpServerResponse(req, res, new backend.OpenAIAdapter({}), HEADERS);
});
server.listen(port, function () {
  console.log("Server running at http://localhost:".concat(port, "/"));
});
