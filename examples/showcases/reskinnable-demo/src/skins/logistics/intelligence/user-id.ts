/**
 * Resolve a stable end-user identity for Intelligence requests (thread +
 * durable-memory scoping). SERVER-SAFE: plain .ts, no "use client", no JSX.
 *
 * Precedence: pinned env > mapped planner id > role-derived > demo default.
 * The pinned env wins so CI (Playwright/aimock) stays deterministic on one
 * seeded identity.
 */

/** Planner id (seed.json) -> memory scope. Kept 1:1 so two on-screen people
 *  never share one memory scope. */
const PLANNER_IDENTITY: Record<string, { userId: string; userName: string }> = {
  "pl-rosa": { userId: "rosa-delgado", userName: "Rosa Delgado" },
  "pl-ibrahim": { userId: "ibrahim-okonjo", userName: "Ibrahim Okonjo" },
};

export const SEEDED_USER_IDS: readonly string[] = Object.values(
  PLANNER_IDENTITY,
).map((p) => p.userId);

export const DEMO_DEFAULT_USER_ID = "meridian-demo-user";

export type IdentityInput = { plannerId?: string; role?: string };

function roleSlug(role?: string): string {
  if (!role) return DEMO_DEFAULT_USER_ID;
  const slug = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `meridian-${slug}` : DEMO_DEFAULT_USER_ID;
}

export function resolveUserId({ plannerId, role }: IdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;
  if (plannerId && PLANNER_IDENTITY[plannerId])
    return PLANNER_IDENTITY[plannerId].userId;
  return roleSlug(role);
}

export function resolveUserName({
  plannerId,
  role,
}: IdentityInput = {}): string {
  if (process.env.INTELLIGENCE_USER_ID) {
    return (
      process.env.INTELLIGENCE_USER_NAME ?? process.env.INTELLIGENCE_USER_ID
    );
  }
  if (plannerId && PLANNER_IDENTITY[plannerId])
    return PLANNER_IDENTITY[plannerId].userName;
  return role ? `Meridian ${role}` : "Meridian Demo User";
}

/**
 * The logistics skin's `IdentifyRunUser`, registered in agent-registry.ts. The
 * client forwards the active planner through CopilotKit `properties`
 * ({ userRole, userId }); this maps them onto a stable per-planner scope
 * WITHOUT the shared API route importing anything skin-specific.
 */
export function logisticsIdentifyUser(
  properties: { userRole?: string; userId?: string } | undefined,
): { id: string; name: string } {
  const input: IdentityInput = {
    plannerId: properties?.userId,
    role: properties?.userRole,
  };
  return { id: resolveUserId(input), name: resolveUserName(input) };
}
