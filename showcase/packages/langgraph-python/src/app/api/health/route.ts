import { NextResponse } from "next/server";

const LANGGRAPH_URL =
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

export async function GET() {
    let langGraphStatus = "unknown";
    let langGraphDetail = "";

    try {
        const res = await fetch(`${LANGGRAPH_URL}/ok`, {
            signal: AbortSignal.timeout(3000),
        });
        langGraphStatus = res.ok ? "ok" : `error`;
        langGraphDetail = `HTTP ${res.status}`;
    } catch (e: any) {
        langGraphStatus = "down";
        langGraphDetail = e.message;
    }

    return NextResponse.json({
        status: "ok",
        integration: "langgraph-python",
        version: "2.0.0",
        timestamp: new Date().toISOString(),
        agent: {
            url: LANGGRAPH_URL,
            status: langGraphStatus,
            detail: langGraphDetail,
        },
        env: {
            OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
            NODE_ENV: process.env.NODE_ENV,
            PORT: process.env.PORT,
        },
    });
}
