import { createServer } from "node:http";
import express from "express";
import { copilotRuntimeNodeHttpEndpoint } from "@copilotkit/runtime";

const app = express();

const copilotRuntime = copilotRuntimeNodeHttpEndpoint({
  graphql: {
    endpoint: "/copilotkit"
  }
});

app.use("/copilotkit", copilotRuntime);

app.listen(4000, () => {
  console.log("Listening at http://localhost:4000/copilotkit");
});

