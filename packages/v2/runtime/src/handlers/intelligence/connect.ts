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
  if (!runtime.intelligenceSdk) {
    return jsonResponse(
      {
        error: "Intelligence SDK not configured",
        message: "Intelligence mode requires a CopilotIntelligenceSdk",
      },
      500,
    );
  }

  try {
    const result = await runtime.intelligenceSdk.connectThread({
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

    return jsonResponse(
      {
        error: "Connect plan not available",
        message: error instanceof Error ? error.message : String(error),
      },
      404,
    );
  }
}
