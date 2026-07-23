import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the generic agent backends — every
 * `showcase-<framework>` integration service routes through this driver
 * (mastra, ag2, agno, llamaindex, langgraph-*, crewai-*, pydantic-ai,
 * google-adk, claude-sdk-*, ms-agent-*, langroid, spring-ai, strands,
 * built-in-agent — 19 services in the SSOT at WS-C completion).
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on
 * `/api/health` (the uniform health path emitted by every showcase
 * integration template). Future driver-specific layer: feature-level
 * fixture POST into the integration's `/api` endpoint, asserting the
 * AG-UI SSE stream opens and emits at least one TextMessageStart event.
 */
export async function probeAgent(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "agent",
    healthcheckPath: "/api/health",
  });
}
