import { createServer } from "node:http";
import { copilotRuntimeNodeHttpEndpoint } from "@copilotkit/runtime";

const copilotRuntime = copilotRuntimeNodeHttpEndpoint({
  graphql: {
    endpoint: "/copilotkit"
  }
});
const server = createServer(copilotRuntime);

server.listen(4000, () => {
  console.log("Listening at http://localhost:4000/copilotkit");
});