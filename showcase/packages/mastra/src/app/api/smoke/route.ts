import { NextResponse } from "next/server";
import {
    CopilotRuntime,
    ExperimentalEmptyAdapter,
    copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { MastraAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";

const INTEGRATION_SLUG = "mastra";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
    const start = Date.now();

    try {
        const runtime = new CopilotRuntime({
            // @ts-expect-error -- typing mismatch pending release fix
            agents: MastraAgent.getLocalAgents({ mastra }),
        });

        const body = JSON.stringify({
            messages: [{ role: "user", content: "Respond with exactly: OK" }],
            tools: [],
            agentId: "weather-agent",
        });

        const req = new Request("http://localhost/api/copilotkit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });

        const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
            runtime,
            serviceAdapter: new ExperimentalEmptyAdapter(),
            endpoint: "/api/copilotkit",
        });

        const response = await handleRequest(req);
        const latency = Date.now() - start;

        if (!response.ok) {
            return NextResponse.json({
                status: "error",
                integration: INTEGRATION_SLUG,
                stage: "runtime_response",
                error: `Runtime returned ${response.status}`,
                latency_ms: latency,
                timestamp: new Date().toISOString(),
            }, { status: 502 });
        }

        const text = await response.text();
        if (text.length === 0) {
            return NextResponse.json({
                status: "error",
                integration: INTEGRATION_SLUG,
                stage: "response_empty",
                error: "Runtime returned empty response body",
                latency_ms: latency,
                timestamp: new Date().toISOString(),
            }, { status: 502 });
        }

        return NextResponse.json({
            status: "ok",
            integration: INTEGRATION_SLUG,
            latency_ms: latency,
            timestamp: new Date().toISOString(),
        });
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        const latency = Date.now() - start;

        let stage = "unknown";
        if (err.message.includes("fetch")) stage = "agent_unreachable";
        else if (err.message.includes("timeout") || err.message.includes("AbortError")) stage = "timeout";
        else stage = "pipeline_error";

        return NextResponse.json({
            status: "error",
            integration: INTEGRATION_SLUG,
            stage,
            error: err.message,
            latency_ms: latency,
            timestamp: new Date().toISOString(),
        }, { status: 502 });
    }
}
