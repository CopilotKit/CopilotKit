import {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeUser,
} from "../../core/runtime";
import { errorResponse } from "./json-response";
import { isValidIdentifier } from "./intelligence-utils";

export async function resolveIntelligenceUser(params: {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
}): Promise<CopilotRuntimeUser | Response> {
  const { runtime, request } = params;

  try {
    const user = await runtime.identifyUser(request);
    if (!isValidIdentifier(user?.id)) {
      return errorResponse("identifyUser must return a valid user id", 400);
    }
    if (typeof user?.name !== "string" || user.name.trim().length === 0) {
      return errorResponse("identifyUser must return a valid user name", 400);
    }

    return { id: user.id, name: user.name };
  } catch (error) {
    console.error("Error identifying intelligence user:", error);
    return errorResponse("Failed to identify user", 500);
  }
}
