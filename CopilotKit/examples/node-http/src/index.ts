import { createServer } from "node:http";
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNodeHttpEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";
import * as dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai });

const runtime = new CopilotRuntime({
  actions: [
    {
      name: "sayHello",
      description: "say hello so someone by roasting their name",
      parameters: [
        {
          name: "roast",
          description: "A sentence or two roasting the name of the person",
          type: "string",
          required: true,
        },
      ],
      handler: ({ roast }) => {
        console.log(roast);
        return "The person has been roasted.";
      },
    },
  ],
});

const copilotRuntime = copilotRuntimeNodeHttpEndpoint({
  endpoint: "/copilotkit",
  runtime,
  serviceAdapter,
});

// const server = createServer(copilotRuntime);

// OR

const server = createServer((req, res) => {
  return copilotRuntime(req, res);
});

server.listen(4000, () => {
  console.log("Listening at http://localhost:4000/copilotkit");
});
