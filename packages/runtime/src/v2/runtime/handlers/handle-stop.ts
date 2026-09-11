import type { CopilotRuntimeLike } from "../core/runtime";
import { resolveAgents } from "../core/runtime";
import { EventType } from "@ag-ui/client";

interface StopAgentParameters {
  request: Request;
  runtime: CopilotRuntimeLike;
  agentId: string;
  threadId: string;
}

export async function handleStopAgent({
  runtime,
  request,
  agentId,
  threadId,
}: StopAgentParameters) {
  try {
    const agents = await resolveAgents(runtime.agents, request);

    if (!agents[agentId]) {
      return new Response(
        JSON.stringify({
          error: "Agent not found",
          message: `Agent '${agentId}' does not exist`,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // An absent body preserves thread-wide stop for existing clients.
    let runId: string | undefined;
    try {
      const text = await request.text();
      const body: unknown = text.trim() ? JSON.parse(text) : {};
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("Expected an object");
      }
      if (Object.keys(body).some((key) => key !== "runId")) {
        throw new Error("Unexpected stop request field");
      }
      if ("runId" in body && body.runId !== undefined) {
        if (typeof body.runId !== "string" || body.runId.length === 0) {
          throw new Error("Expected a non-empty runId");
        }
        runId = body.runId;
      }
    } catch {
      return new Response(JSON.stringify({ error: "Invalid stop request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stopped = await runtime.runner.stop({ threadId, ...(runId === undefined ? {} : { runId }) });

    if (!stopped) {
      return new Response(
        JSON.stringify({
          stopped: false,
          message: `No active run for thread '${threadId}'.`,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        stopped: true,
        interrupt: {
          type: EventType.RUN_ERROR,
          message: "Run stopped by user",
          code: "STOPPED",
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error stopping agent run:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to stop agent",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
