import cors from "cors";
import express from "express";
import { addPing, addStrandsExpressEndpoint } from "@ag-ui/aws-strands/server";

import { agent } from "./agent.js";
import { withForwardedHeaders } from "./header-forwarding.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});
addPing(app, "/ping");

app.post("/", (request, _response, next) => {
  withForwardedHeaders(request, next);
});
addStrandsExpressEndpoint(app, agent, { path: "/" });

const port = Number(process.env.AGENT_PORT ?? 8000);
const host = process.env.AGENT_HOST ?? "0.0.0.0";

app.listen(port, host, () => {
  console.log(
    `[agent] AWS Strands TypeScript starter listening on ${host}:${port}`,
  );
});
