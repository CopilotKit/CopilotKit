/**
 * Strands TypeScript showcase agent server.
 *
 * An Express app exposing AG-UI SSE endpoints, mirroring the Python sibling's
 * `agent_server.py`: a single shared showcase agent at `/`, plus tool-free
 * specialized agents on dedicated sub-paths (`/voice`, `/byoc-hashbrown`,
 * `/byoc-json-render`). The Next.js CopilotKit runtime proxies here via the
 * AG-UI protocol (HttpAgent), so per-demo differentiation lives on the
 * frontend.
 *
 * Run with `node --import tsx server.ts` (tsx is a one-shot ESM loader, not a
 * watcher) — see package.json.
 */

import express from "express";
import cors from "cors";
import { addStrandsExpressEndpoint, addPing } from "@ag-ui/aws-strands/server";
import type { StrandsAgent } from "@ag-ui/aws-strands";
import {
  buildShowcaseAgent,
  buildVoiceAgent,
  buildByocHashbrownAgent,
  buildByocJsonRenderAgent,
  buildA2uiFixedSchemaAgent,
} from "./agent";

/** Mount an agent at `path` and `path/` so trailing-slash proxies resolve. */
function mountAgent(
  app: express.Express,
  path: string,
  agent: StrandsAgent,
): void {
  addStrandsExpressEndpoint(app, agent, { path });
  if (path !== "/") {
    addStrandsExpressEndpoint(app, agent, { path: `${path}/` });
  }
}

async function main(): Promise<void> {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  // 25mb so the multimodal demo's base64 image/PDF uploads fit comfortably.
  app.use(express.json({ limit: "25mb" }));

  // Health + ping registered BEFORE the agent POST endpoints. They are GET
  // routes so they never collide with the agents' POST handlers, but keeping
  // them first makes the contract explicit. The Next.js runtime probes
  // `${AGENT_URL}/health`.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  addPing(app, "/ping");

  const [showcase, voice, hashbrown, jsonRender, a2uiFixed] = await Promise.all(
    [
      buildShowcaseAgent(),
      buildVoiceAgent(),
      buildByocHashbrownAgent(),
      buildByocJsonRenderAgent(),
      buildA2uiFixedSchemaAgent(),
    ],
  );

  mountAgent(app, "/voice", voice);
  mountAgent(app, "/byoc-hashbrown", hashbrown);
  mountAgent(app, "/byoc-json-render", jsonRender);
  // Fixed-schema A2UI: the dedicated agent wires its OWN backend tool
  // (`display_flight`) returning an a2ui_operations envelope; the runtime
  // A2UIMiddleware paints it directly. No generate_a2ui injection.
  mountAgent(app, "/a2ui-fixed-schema", a2uiFixed);
  // Mount the shared agent LAST at the root so the sub-path POST routes are
  // matched first by Express's route table.
  mountAgent(app, "/", showcase);

  const port = Number(process.env.PORT ?? 8000);
  const host = process.env.HOST ?? "0.0.0.0";
  app.listen(port, host, () => {
    console.log(`[agent] Strands TS server listening on ${host}:${port}`);
  });
}

main().catch((err) => {
  console.error("[agent] Fatal:", err);
  process.exit(1);
});
