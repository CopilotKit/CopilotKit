/**
 * CopilotKit runtime hosting the managed-agent finance assistant.
 *
 * The browser's CopilotKitProvider talks to this endpoint; the runtime
 * dispatches each chat turn to a ManagedAgentsAgent from
 * @ag-ui/claude-managed-agents, which maps the AG-UI thread to a Claude
 * Managed Agents session and translates its events for CopilotKit.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CopilotSseRuntime } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
import { ManagedAgentsAgent } from "@ag-ui/claude-managed-agents";
import {
  createCopilotRequestBodyParser,
  createFinancialAssistantAgentConfig,
} from "./runtimeLimits.ts";
import { loadAgentIds } from "./setup.ts";

const PORT = Number(process.env.PORT ?? 8787);

// Fail fast: a clear "run npm run setup first" at boot beats a mid-chat error.
const ids = loadAgentIds();

const runtime = new CopilotSseRuntime({
  agents: {
    "financial-assistant": new ManagedAgentsAgent(
      createFinancialAssistantAgentConfig(ids),
    ),
  },
});

// Unset: permissive CORS (fine locally). On a public deployment, set
// ALLOWED_ORIGINS to your frontend's origin(s), comma-separated: this
// endpoint spends your API credits. Set-but-empty means deny cross-origin.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.use("/api/copilotkit", createCopilotRequestBodyParser());
app.use(
  createCopilotExpressHandler({
    runtime,
    basePath: "/api/copilotkit",
    cors: allowedOrigins ? { origin: allowedOrigins } : true,
  }),
);

// Single-process deploys: after `npm run build`, serve the built frontend
// from the same port as the runtime. Absent in dev, where Vite serves it.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  console.log(`Serving web/dist as the frontend`);
}

app.listen(PORT, () => {
  console.log(
    `CopilotKit runtime listening on http://localhost:${PORT}/api/copilotkit`,
  );
});
