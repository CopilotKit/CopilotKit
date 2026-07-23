// CopilotKit runtime for the Observational Memory cell.
//
// Observational Memory (OM) is a Mastra `Memory` feature the agent opts into
// (see `observationalMemoryAgent` in src/mastra/agents/index.ts). As the
// conversation grows, Mastra runs an Observer out of band that compresses the
// unobserved messages into observations and activates them — surfacing that
// work on the run's `fullStream` as `data-om-*` chunks.
//
// The AG-UI Mastra adapter only maps those chunks to AG-UI activity events
// when the surfacing toggle is on. That toggle lives on `getLocalAgents`
// (PLURAL) — `getLocalAgent` (singular) does NOT expose it — so we build the
// agent set with `observationalMemory: true` and pick our agent out of the
// returned record (keyed by the Mastra registration key,
// `observationalMemoryAgent`).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgents } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

// @region[runtime-observational-memory-config]
// `observationalMemory: true` is the adapter surfacing opt-in (default OFF).
// It only controls whether the bridge FORWARDS the `data-om-*` chunks the
// agent streams — the agent must ALSO have OM enabled on its Memory (it does).
const localAgents = getLocalAgents({
  mastra,
  resourceId: "mastra-observationalMemoryAgent",
  observationalMemory: true,
});

const observationalMemoryAgent = localAgents["observationalMemoryAgent"];
if (!observationalMemoryAgent) {
  throw new Error(
    "getLocalAgents did not return observationalMemoryAgent — required for /demos/observational-memory",
  );
}

const runtime = new CopilotRuntime({
  agents: {
    "observational-memory": observationalMemoryAgent,
    default: observationalMemoryAgent,
  },
});
// @endregion[runtime-observational-memory-config]

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit-observational-memory",
        serviceAdapter: new ExperimentalEmptyAdapter(),
        runtime,
      });
      return await handleRequest(req);
    } catch (error: unknown) {
      const e = error as { message?: string; stack?: string };
      return NextResponse.json(
        { error: e.message, stack: e.stack },
        { status: 500 },
      );
    }
  });
