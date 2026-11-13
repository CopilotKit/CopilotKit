// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema) cell.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8123";

const declarativeGenUiAgent = new LangGraphAgent({
  deploymentUrl: `${AGENT_URL}/`,
  graphId: "a2ui_dynamic",
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
  // The agent speaks A2UI v0.9. The page passes a catalog to the provider,
  // so the runtime turns on `injectA2UITool` for the run, and the agent
  // adapter adds `generate_a2ui` and paints the surfaces it returns.
  generativeUI: { a2uiVersion: "0.9" },
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-declarative-gen-ui",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
