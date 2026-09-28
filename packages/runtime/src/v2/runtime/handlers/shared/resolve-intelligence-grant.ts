import type {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeUser,
  IntelligenceAccessGrant,
  IntelligenceAccessPermission,
  IntelligenceAccessScope,
  IntelligenceAccessSurface,
} from "../../core/runtime";
import { errorResponse } from "./json-response";

const PERMISSIONS: ReadonlySet<string> = new Set<IntelligenceAccessPermission>([
  "analytics.numbers",
  "analytics.topics",
  "learning.insights_skills",
  "governance.record",
  "conversations.text",
]);

/** What a policy that declines everything resolves to. */
const NO_ACCESS: IntelligenceAccessGrant = Object.freeze({
  permissions: Object.freeze({}),
});

type GrantResolution = IntelligenceAccessGrant | undefined | Response;

const resolvedGrants = new WeakMap<
  Request,
  Map<IntelligenceAccessSurface, Promise<GrantResolution>>
>();

/**
 * Resolves the Intelligence access grant for one authenticated request.
 *
 * - No `access` policy: `undefined`. The caller sends no grant, and
 *   Intelligence denies every grant-gated read (closed by default).
 * - `null`: an explicit empty grant, sent so Intelligence denies everything.
 * - A malformed grant or a throwing policy: a 500 `Response`. A broken
 *   policy must fail loudly rather than quietly widen or narrow access.
 *
 * The policy runs once per request and surface unless a long-running read
 * explicitly refreshes it before returning protected data.
 */
export function resolveIntelligenceGrant(params: {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  user: CopilotRuntimeUser;
  surface: IntelligenceAccessSurface;
  refresh?: boolean;
}): Promise<GrantResolution> {
  if (params.refresh) return resolveGrant(params);
  const { request, surface } = params;
  let bySurface = resolvedGrants.get(request);
  if (!bySurface) {
    bySurface = new Map();
    resolvedGrants.set(request, bySurface);
  }
  const existing = bySurface.get(surface);
  if (existing) return existing;
  const resolution = resolveGrant(params);
  bySurface.set(surface, resolution);
  return resolution;
}

async function resolveGrant({
  runtime,
  request,
  user,
  surface,
}: {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  user: CopilotRuntimeUser;
  surface: IntelligenceAccessSurface;
}): Promise<GrantResolution> {
  if (!runtime.access) return undefined;
  let grant: unknown;
  try {
    grant = await runtime.access({ request, user, surface });
  } catch (error) {
    console.error("Error resolving Intelligence access grant:", error);
    return errorResponse("Intelligence access policy failed", 500);
  }
  if (grant === null) return NO_ACCESS;
  const normalized = normalizeGrant(grant);
  if (!normalized) {
    return errorResponse(
      "Intelligence access policy returned an invalid grant",
      500,
    );
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeScope(value: unknown): IntelligenceAccessScope | undefined {
  if (!isRecord(value)) return undefined;
  const { agents } = value;
  if (agents === "*") return Object.freeze({ agents: "*" });
  if (
    !Array.isArray(agents) ||
    !agents.every(
      (agent): agent is string =>
        typeof agent === "string" && agent.trim().length > 0,
    )
  ) {
    return undefined;
  }
  return Object.freeze({ agents: Object.freeze([...agents]) });
}

/** Copies only the known shape, so later mutation of the policy's value is inert. */
function normalizeGrant(value: unknown): IntelligenceAccessGrant | undefined {
  if (!isRecord(value) || !isRecord(value.permissions)) return undefined;
  const permissions: Partial<
    Record<IntelligenceAccessPermission, IntelligenceAccessScope>
  > = {};
  for (const [permission, scope] of Object.entries(value.permissions)) {
    if (!PERMISSIONS.has(permission)) return undefined;
    const normalized = normalizeScope(scope);
    if (!normalized) return undefined;
    permissions[permission as IntelligenceAccessPermission] = normalized;
  }
  return Object.freeze({ permissions: Object.freeze(permissions) });
}
