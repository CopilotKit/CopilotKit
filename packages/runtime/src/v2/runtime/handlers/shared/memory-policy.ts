import type {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeUser,
  MemoryConsumer,
  MemoryGrant,
} from "../../core/runtime";
import { errorResponse } from "./json-response";

const ACCESS = new Set(["none", "read", "read-write"]);

/** What a policy that declines Memory entirely resolves to. */
const NO_MEMORY: MemoryGrant = Object.freeze({
  user: "none",
  project: "none",
});

export interface ResolvedWebMemory {
  readonly user: CopilotRuntimeUser;
  readonly grant: MemoryGrant;
}

/**
 * True when a grant asks for any Memory operation at all.
 *
 * The web counterpart of `hasMemoryAccess` in `@copilotkit/channels-core`, and
 * deliberately the same predicate: a grant with every scope at `"none"` means
 * "this request gets no Memory", NOT "refuse this request". Channels has always
 * read it that way — there both scopes are optional and default to `"none"`, so
 * all-none is the grant you get by writing nothing, which could not coherently
 * mean refusal.
 */
export function grantAllowsMemory(grant: MemoryGrant): boolean {
  return grant.user !== "none" || grant.project !== "none";
}

/**
 * Evaluates and validates one configured web Memory policy.
 *
 * Resolving is separate from ACTING on the result, because the two callers want
 * opposite things from a policy that grants nothing:
 *
 *   - An agent run wants to proceed WITHOUT Memory tools. `memory.access` is a
 *     Memory policy, not an authorization gate on the conversation; a runtime
 *     that wants to reject the request outright has `beforeRequestMiddleware`
 *     for exactly that. Failing the run here means a deployment that switches
 *     Memory off for one tenant gets no assistant at all, and the failure
 *     surfaces as a bare run error rather than as anything a user can read.
 *   - The browser Memory routes want a 403. There the caller asked for memories
 *     specifically, so "you may not have them" is the honest answer, and an
 *     empty list would imply none exist.
 *
 * So this returns the grant (or a Response for a genuinely broken policy), and
 * each call site applies `grantAllowsMemory` to its own case.
 */
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
    // `null` is the policy declining to grant anything, which is the same
    // outcome as an explicit all-none grant — not a distinct third state.
    const resolved = grant ?? NO_MEMORY;
    if (!ACCESS.has(resolved.user) || !ACCESS.has(resolved.project)) {
      return errorResponse("Memory policy returned an invalid grant", 500);
    }
    return { user, grant: { user: resolved.user, project: resolved.project } };
  } catch {
    return errorResponse("Memory policy failed", 500);
  }
}
