import express from "express";
import { CopilotRuntime, BuiltInAgent } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-5-mini" }),
  },
});

const app = express();
app.use(
  createCopilotExpressHandler({
    runtime,
    basePath: "/api/copilotkit",
  }),
);

const port = Number(process.env.PORT ?? 4002);
app.listen(port, () => {
  console.log(
    `Express runtime listening on http://localhost:${port}/api/copilotkit`,
  );
});
