import type { CopilotRuntimeLike } from "../core/runtime";
import { isIntelligenceRuntime } from "../core/runtime";
import {
  isValidTrajectoryId,
  TrajectoryConnectionError,
} from "../intelligence-platform/trajectories";
import { resolveIntelligenceUser } from "./shared/resolve-intelligence-user";

export function trajectoryErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json(
    { code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function handleTrajectoryConnect({
  runtime,
  request,
  trajectoryId,
}: {
  runtime: CopilotRuntimeLike;
  request: Request;
  trajectoryId: string;
}): Promise<Response> {
  if (!isValidTrajectoryId(trajectoryId)) {
    return trajectoryErrorResponse(
      "INVALID_REQUEST",
      "A valid trajectoryId is required",
      400,
    );
  }
  if (!isIntelligenceRuntime(runtime)) {
    return trajectoryErrorResponse(
      "INTELLIGENCE_RUNTIME_REQUIRED",
      "Trajectory capture requires an Intelligence runtime",
      503,
    );
  }
  if (!runtime.identifyUser) {
    return trajectoryErrorResponse(
      "IDENTITY_REQUIRED",
      "Trajectory capture requires an identified user",
      401,
    );
  }
  const user = await resolveIntelligenceUser({ runtime, request });
  if (user instanceof Response) {
    return trajectoryErrorResponse(
      "IDENTITY_REQUIRED",
      "Trajectory capture requires an identified user",
      401,
    );
  }

  try {
    const grant = await runtime.intelligence.ɵconnectTrajectory({
      trajectoryId,
      user,
      signal: request.signal,
    });
    return Response.json(grant, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TrajectoryConnectionError) {
      return trajectoryErrorResponse(error.code, error.message, error.status);
    }
    return trajectoryErrorResponse(
      "CONNECTION_FAILED",
      "Could not connect to Intelligence",
      502,
    );
  }
}
