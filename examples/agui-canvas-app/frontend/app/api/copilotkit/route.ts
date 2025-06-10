import {
    CopilotRuntime,
    OpenAIAdapter,
    copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

const serviceAdapter = new OpenAIAdapter();

const langgraphAgent = new HttpAgent({
    url: "http://0.0.0.0:8000/langgraph-agent",
});
const runtime = new CopilotRuntime({
    agents: {
        langgraphAgent
    },
});



export const POST = async (req: NextRequest) => {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        runtime,
        serviceAdapter,
        endpoint: "/api/copilotkit",
    });

    return handleRequest(req);
};
