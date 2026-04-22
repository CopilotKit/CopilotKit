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

    const stopped = await runtime.runner.stop({ threadId });

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
