import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";
 
// 1. Service adapter for multi-agent support (empty since we only have one agent)
const serviceAdapter = new ExperimentalEmptyAdapter();
 
// 2. 🪁 Connect CopilotKit to PydanticAI via HttpAgent
// The HttpAgent creates a bridge between the Next.js frontend and the Python backend
// It communicates with the FastAPI server created by agent.to_ag_ui()
const runtime = new CopilotRuntime({
  agents: {
    // "my_agent" maps to the agent name used in useCoAgent() on the frontend
    // The HttpAgent connects to the PydanticAI FastAPI server at port 8000
    "my_agent": new HttpAgent({ url: "http://localhost:8000/" }),
  }   
});
 
// 3. Next.js API route handler that proxies requests between frontend and backend
export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime, 
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
 
  return handleRequest(req);
};