import {
  parseInspectorLearningRequestV1,
  parseInspectorLearningSnapshotV1,
} from "@copilotkit/shared";
import type { CopilotRuntimeLike } from "../core/runtime";
import { isIntelligenceRuntime } from "../core/runtime";
import { PlatformRequestError } from "../intelligence-platform/client";

const headers = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json",
} as const;

const errorResponse = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers });

const queryPage = (value: string | null): number | undefined =>
  value === null ? undefined : Number(value);

/** Proxies a bounded Learning read through the runtime's server-held credential. */
export async function handleInspectorLearning({
  runtime,
  request,
  enabled,
}: {
  readonly runtime: CopilotRuntimeLike;
  readonly request: Request;
  readonly enabled: boolean;
}): Promise<Response> {
  if (
    !enabled ||
    runtime.debug?.enabled !== true ||
    !isIntelligenceRuntime(runtime)
  ) {
    return errorResponse(404, "Not found");
  }
  const url = new URL(request.url);
  if (
    [...url.searchParams.keys()].some(
      (key) => !["agentId", "skillsPage", "insightsPage"].includes(key),
    )
  ) {
    return errorResponse(400, "Invalid Inspector Learning request");
  }
  const parsedRequest = parseInspectorLearningRequestV1({
    agentId: url.searchParams.get("agentId") ?? undefined,
    skillsPage: queryPage(url.searchParams.get("skillsPage")),
    insightsPage: queryPage(url.searchParams.get("insightsPage")),
  });
  if (!parsedRequest)
    return errorResponse(400, "Invalid Inspector Learning request");

  try {
    const snapshot = parseInspectorLearningSnapshotV1(
      await runtime.intelligence.getInspectorLearning({
        ...parsedRequest,
        ...(typeof runtime.learning?.containerId === "string"
          ? { runtimeContainerId: runtime.learning.containerId }
          : {}),
      }),
    );
    if (!snapshot)
      return errorResponse(502, "Invalid Inspector Learning response");
    return new Response(JSON.stringify(snapshot), { status: 200, headers });
  } catch (error) {
    if (error instanceof PlatformRequestError && error.status === 404) {
      return errorResponse(404, "Not found");
    }
    return errorResponse(503, "Inspector Learning is temporarily unavailable");
  }
}
