import express from "express";
import * as dotenv from "dotenv";
dotenv.config();
import {
  CopilotRuntime,
  copilotRuntimeNodeHttpEndpoint,
  OpenAIAdapter,
  OpenAIAdapterParams,
} from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai } as unknown as OpenAIAdapterParams);

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
      handler: ({ roast }: { roast: string }) => {
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

const app = express();

app.use("/copilotkit", copilotRuntime);

app.listen(4000, () => {
  console.log("Listening at http://localhost:4000/copilotkit");
});
