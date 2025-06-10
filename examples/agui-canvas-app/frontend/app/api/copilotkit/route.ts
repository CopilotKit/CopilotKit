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

const mastraAgent = new HttpAgent({
    url: "http://0.0.0.0:8000/mastra-agent",
});

const crewaiAgent = new HttpAgent({
    url: "http://0.0.0.0:8000/crewai-agent",
});

const runtime = new CopilotRuntime({
    agents: {
        langgraphAgent,
        mastraAgent,
        crewaiAgent
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
