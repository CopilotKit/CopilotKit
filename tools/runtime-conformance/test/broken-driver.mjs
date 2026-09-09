import { createServer } from "node:http";

// Deliberately broken implementation used to prove the harness rejects false success.
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end("{}");
});
server.listen(0, "127.0.0.1", () =>
  process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n"),
);
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close();
});
