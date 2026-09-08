import type {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeUser,
  MemoryConsumer,
  MemoryGrant,
} from "../../core/runtime";
import { errorResponse } from "./json-response";

const ACCESS = new Set(["none", "read", "read-write"]);

export interface ResolvedWebMemory {
  readonly user: CopilotRuntimeUser;
  readonly grant: MemoryGrant;
}

/** Evaluates and validates one configured web Memory policy. */
export async function resolveWebMemory(
  runtime: CopilotIntelligenceRuntimeLike,
  request: Request,
  user: CopilotRuntimeUser,
  consumer: MemoryConsumer,
): Promise<ResolvedWebMemory | Response> {
  if (!runtime.memory) {
    return {
      user,
      grant: { user: "read-write", project: "read-write" },
    };
  }

  try {
    const grant = await runtime.memory.access({ request, user, consumer });
    if (grant === null || (grant.user === "none" && grant.project === "none")) {
      return errorResponse("Memory access denied", 403);
    }
    if (!ACCESS.has(grant.user) || !ACCESS.has(grant.project)) {
      return errorResponse("Memory policy returned an invalid grant", 500);
    }
    return { user, grant: { user: grant.user, project: grant.project } };
  } catch {
    return errorResponse("Memory policy failed", 500);
  }
}
