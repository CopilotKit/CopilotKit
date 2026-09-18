import type { CopilotRuntimeLike } from "../core/runtime";
import { isIntelligenceRuntime, resolveAgents } from "../core/runtime";
import { EventType } from "@ag-ui/client";
import { resolveIntelligenceUser } from "./shared/resolve-intelligence-user";
import { isHandlerResponse } from "./shared/json-response";
import { getPlatformErrorStatus } from "./shared/intelligence-utils";

interface StopAgentParameters {
  request: Request;
  runtime: CopilotRuntimeLike;
  agentId: string;
  threadId: string;
}

/** Stop an active run after applying the runtime's application identity policy. */
export async function handleStopAgent({
  runtime,
  request,
  agentId,
  threadId,
}: StopAgentParameters): Promise<Response> {
  try {
    let stopThreadId = threadId;
    let runId: string | undefined;
    if (isIntelligenceRuntime(runtime)) {
      const bodyRequest = request.clone();
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;
      try {
        const raw = await bodyRequest.text();
        const body: unknown = raw.trim() ? JSON.parse(raw) : {};
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return Response.json(
            { error: "Invalid stop request" },
            { status: 400 },
          );
        }
        if ("runId" in body) {
          if (typeof body.runId !== "string" || !body.runId.trim()) {
            return Response.json({ error: "Invalid runId" }, { status: 400 });
          }
          runId = body.runId;
        }
      } catch {
        return Response.json(
          { error: "Invalid stop request" },
          { status: 400 },
        );
      }
      try {
        const thread = await runtime.intelligence.getThread({
          threadId,
          userId: user.id,
        });
        if (!thread || typeof thread.id !== "string" || !thread.id.trim()) {
          return Response.json(
            { error: "Invalid thread response" },
            { status: 502 },
          );
        }
        if (thread.agentId !== undefined && thread.agentId !== agentId) {
          return Response.json(
            { error: "Thread access denied" },
            { status: 403 },
          );
        }
        stopThreadId = thread.id;
      } catch (error) {
        const status = getPlatformErrorStatus(error);
        return Response.json(
          { error: "Thread access denied" },
          { status: status && status >= 400 && status < 500 ? status : 502 },
        );
      }
    }
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

    const stopped = await runtime.runner.stop({
      threadId: stopThreadId,
      ...(runId === undefined ? {} : { runId }),
    });

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
