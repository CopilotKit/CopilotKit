import { CopilotIntelligenceRuntimeLike } from "../../runtime";
import { jsonResponse } from "../shared/json-response";
import { isPlatformNotFoundError } from "../shared/intelligence-utils";

interface HandleIntelligenceConnectParams {
  runtime: CopilotIntelligenceRuntimeLike;
  threadId: string;
  lastSeenEventId: string | null;
}

export async function handleIntelligenceConnect({
  runtime,
  threadId,
  lastSeenEventId,
}: HandleIntelligenceConnectParams): Promise<Response> {
  if (!runtime.intelligence) {
    return jsonResponse(
      {
        error: "Intelligence SDK not configured",
        message: "Intelligence mode requires a CopilotKitIntelligence",
      },
      500,
    );
  }

  try {
    const result = await runtime.intelligence.ɵconnectThread({
      threadId,
      lastSeenEventId,
    });

    if (result === null) {
      return new Response(null, {
        status: 204,
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (isPlatformNotFoundError(error)) {
      return new Response(null, {
        status: 204,
      });
    }

    console.error("Connect plan not available:", error);
    return jsonResponse(
      {
        error: "Connect plan not available",
      },
      404,
    );
  }
}
