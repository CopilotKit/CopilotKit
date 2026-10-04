import {
  logger,
  parseInspectorLearningRequestV1,
  parseInspectorLearningSnapshotV1,
} from "@copilotkit/shared";
import type { CopilotRuntimeLike } from "../core/runtime";
import { hasLearningContainerConfiguration } from "../core/learning";
import { isIntelligenceRuntime } from "../core/runtime";
import { PlatformRequestError } from "../intelligence-platform/client";
import { resolveIntelligenceUser } from "./shared/resolve-intelligence-user";
import { resolveIntelligenceGrant } from "./shared/resolve-intelligence-grant";

const headers = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json",
} as const;

const errorResponse = (status: number, message: string, code?: string) =>
  new Response(
    JSON.stringify(
      code === undefined ? { error: message } : { error: message, code },
    ),
    { status, headers },
  );

/**
 * Intelligence access denials the runtime passes through unchanged in status
 * and code, so the Inspector can tell "not allowed" apart from an outage.
 */
const GOVERNANCE_DENIALS: Readonly<
  Record<string, { readonly status: number; readonly message: string }>
> = {
  GOVERNANCE_PERMISSION_DENIED: {
    status: 403,
    message: "You do not have permission to view Inspector Learning",
  },
  GOVERNANCE_GRANT_INVALID: {
    status: 400,
    message: "The Inspector Learning access grant is invalid",
  },
};

const queryPage = (value: string | null): number | undefined =>
  value === null ? undefined : Number(value);

/** Proxies a bounded Learning read through the runtime's server-held credential. */
export async function handleInspectorLearning({
  runtime,
  request,
}: {
  readonly runtime: CopilotRuntimeLike;
  readonly request: Request;
}): Promise<Response> {
  if (
    !isIntelligenceRuntime(runtime) ||
    !hasLearningContainerConfiguration(runtime)
  ) {
    return errorResponse(404, "Not found");
  }
  const user = await resolveIntelligenceUser({ runtime, request });
  if (user instanceof Response) return user;
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
  const grant = await resolveIntelligenceGrant({
    runtime,
    request,
    user,
    surface: "inspector",
  });
  if (grant instanceof Response) return grant;

  try {
    const snapshot = parseInspectorLearningSnapshotV1(
      await runtime.intelligence.getInspectorLearning({
        ...parsedRequest,
        ...(typeof runtime.learning?.containerId === "string"
          ? { runtimeContainerId: runtime.learning.containerId }
          : {}),
        userId: user.id,
        ...(grant !== undefined ? { grant } : {}),
      }),
    );
    if (!snapshot)
      return errorResponse(502, "Invalid Inspector Learning response");
    return new Response(JSON.stringify(snapshot), { status: 200, headers });
  } catch (error) {
    if (error instanceof PlatformRequestError && error.status === 404) {
      return errorResponse(404, "Not found");
    }
    if (error instanceof PlatformRequestError && error.code !== undefined) {
      const denial = Object.hasOwn(GOVERNANCE_DENIALS, error.code)
        ? GOVERNANCE_DENIALS[error.code]
        : undefined;
      if (denial?.status === error.status) {
        return errorResponse(denial.status, denial.message, error.code);
      }
    }
    logger.error(
      { err: error },
      "Inspector Learning request to Intelligence failed",
    );
    return errorResponse(503, "Inspector Learning is temporarily unavailable");
  }
}
