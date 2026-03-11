import express from "express";
import * as dotenv from "dotenv";
dotenv.config();
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeExpressEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import cors from "cors";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai: openai as any });

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-4o-mini" }),
  },
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

const copilotRuntime = copilotRuntimeNodeExpressEndpoint({
  endpoint: "/",
  runtime,
  serviceAdapter,
});

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["*"],
  }),
);

// Uncomment this line to parse the request body
// app.use(express.json());

app.use("/copilotkit", copilotRuntime);

app.listen(4000, () => {
  console.log("Listening at http://localhost:4000/copilotkit");
});
