// Dedicated runtime for the Tool Rendering cell.
//
// Backend: a CrewAI `Flow` (NOT a Crew) mounted at `/tool-rendering` on
// the FastAPI agent server. The flow uses `copilotkit_stream` to emit
// AG-UI tool-call events for every tool call, so the frontend's
// `useRenderTool` hook sees the tool calls and renders custom cards
// (e.g. WeatherCard). The default `ChatWithCrewFlow` does NOT emit
// these events for backend-executed tools, which is why the catch-all
// crew endpoint cannot serve tool-rendering.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import crypto from "node:crypto";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/tool-rendering` });
}

const agents: Record<string, AbstractAgent> = {
  "tool-rendering": createAgent(),
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

function logRouteError(err: unknown): string {
  const error = err instanceof Error ? err : new Error(String(err));
  const errorId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      route: "copilotkit-tool-rendering",
      errorId,
      message: error.message,
      stack: error.stack,
    }),
  );
  return errorId;
}

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-tool-rendering",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const errorId = logRouteError(error);
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
