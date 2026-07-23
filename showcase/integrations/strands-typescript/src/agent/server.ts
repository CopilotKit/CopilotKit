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
import { strandsCvdiagMiddleware } from "./cvdiag-backend-strands.js";
import {
  buildShowcaseAgent,
  buildVoiceAgent,
  buildByocHashbrownAgent,
  buildByocJsonRenderAgent,
  buildA2uiFixedSchemaAgent,
  buildA2uiDynamicAgent,
  buildA2uiRecoveryAgent,
} from "./agent";

/** Mount an agent at `path` and `path/` so trailing-slash proxies resolve. */
function mountAgent(
  app: express.Express,
  path: string,
  agent: StrandsAgent,
): void {
  // Mount the CVDIAG / header-forwarding middleware on the SAME path FIRST so
  // Express runs it BEFORE the aws-strands POST handler. It seeds the
  // header-forwarding ALS (so the outbound OpenAI call to aimock carries the
  // inbound x-* incl. X-AIMock-Strict) and — when CVDIAG_BACKEND_EMITTER is on
  // — emits the backend.* boundaries around the streamed response. It calls
  // next() to fall through to the aws-strands handler, which then runs inside
  // the ALS scope (AsyncLocalStorage propagates across the async generator
  // iteration). @ag-ui/aws-strands@0.2.3 reads only req.body + accept and drops
  // inbound x-*, so this re-introduces per-request forwarding without touching
  // the third-party package.
  const mw = strandsCvdiagMiddleware({
    slug: "strands-typescript",
    agentName: "strands_agent",
    provider: "openai",
    modelId: process.env.MODEL_ID ?? "gpt-4o",
  });
  app.post(path, mw);
  addStrandsExpressEndpoint(app, agent, { path });
  if (path !== "/") {
    app.post(`${path}/`, mw);
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

  const [
    showcase,
    voice,
    hashbrown,
    jsonRender,
    a2uiFixed,
    a2uiDynamic,
    a2uiRecovery,
  ] = await Promise.all([
    buildShowcaseAgent(),
    buildVoiceAgent(),
    buildByocHashbrownAgent(),
    buildByocJsonRenderAgent(),
    buildA2uiFixedSchemaAgent(),
    buildA2uiDynamicAgent(),
    buildA2uiRecoveryAgent(),
  ]);

  mountAgent(app, "/voice", voice);
  mountAgent(app, "/byoc-hashbrown", hashbrown);
  mountAgent(app, "/byoc-json-render", jsonRender);
  // Fixed-schema A2UI: the dedicated agent wires its OWN backend tool
  // (`display_flight`) returning an a2ui_operations envelope; the runtime
  // A2UIMiddleware paints it directly. No generate_a2ui injection.
  mountAgent(app, "/a2ui-fixed-schema", a2uiFixed);
  // Dynamic-schema A2UI: the dedicated agent wires NO tool — the runtime's
  // `injectA2UITool: true` makes the adapter auto-inject `generate_a2ui` and
  // GENERATE the surface, stamped with the page's catalog id.
  mountAgent(app, "/declarative-gen-ui", a2uiDynamic);
  // Error-recovery A2UI: same auto-inject setup; aimock fixtures force the
  // inner render to heal or exhaust so the adapter's recovery loop is visible.
  mountAgent(app, "/a2ui-recovery", a2uiRecovery);
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
