/**
 * Resolve a stable end-user identity for Intelligence requests.
 *
 * Single source of truth shared by the CopilotKit runtime's `identifyUser`
 * (api/copilotkit route) AND the presenter-reset memory helpers
 * (forget-memories, seed-memories), so the chat agent, the inspector's Memory
 * tab, and a booth reset all read/write the same per-user memory scope.
 *
 * Precedence: pinned env > mapped member id > role-derived > demo default.
 *  - Pinned `INTELLIGENCE_USER_ID` wins so CI (Playwright/aimock, smokes) stays
 *    deterministic on a single seeded identity.
 *  - Unpinned (the live demo), a known member id maps 1:1 onto a seeded backend
 *    user so the sidebar user switcher drives memory scope. Only ids the
 *    Intelligence stack has seeded are recall-capable (non-seeded ids 403), which
 *    is why the roster maps onto exactly the two seeded users.
 */

/** Member id (seed.json) -> seeded Intelligence identity. Keep 1:1 so scope
 *  isolation reads correctly: two on-screen people must never share one memory. */
const MEMBER_IDENTITY: Record<string, { userId: string; userName: string }> = {
  "9g5h2j1k4l": { userId: "jordan-beamson", userName: "Alex Morgan" }, // Admin
  "2b3c4d5e6f": { userId: "morgan-fluxx", userName: "Maya Chen" }, // Assistant
};

/** The seeded backend user ids (derived from MEMBER_IDENTITY). A full demo
 *  reset clears every seeded persona's memory scope, so callers enumerate this
 *  list rather than resolveUserId() (which returns only the pinned/active one). */
export const SEEDED_USER_IDS: readonly string[] = Object.values(
  MEMBER_IDENTITY,
).map((m) => m.userId);

/** The default/fallback identity used when no member is mapped and no role is
 *  set (roleSlug with no role). A lot of demo memory lands here (e.g. facts
 *  taught before a member is actively selected), and a full reset intentionally
 *  does NOT clear it, so the inspector must include it to "show everything". */
export const DEMO_DEFAULT_USER_ID = "northwind-demo-user";

export type IdentityInput = { memberId?: string; role?: string };

function roleSlug(role?: string): string {
  const slug = (role ?? "demo-user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `northwind-${slug || "demo-user"}`;
}

export function resolveUserId({ memberId, role }: IdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;

  if (memberId && MEMBER_IDENTITY[memberId])
    return MEMBER_IDENTITY[memberId].userId;

  return roleSlug(role);
}

/** The display name to pair with `resolveUserId`. */
export function resolveUserName({
  memberId,
  role,
}: IdentityInput = {}): string {
  const pinnedId = process.env.INTELLIGENCE_USER_ID;
  if (pinnedId) return process.env.INTELLIGENCE_USER_NAME ?? pinnedId;

  if (memberId && MEMBER_IDENTITY[memberId])
    return MEMBER_IDENTITY[memberId].userName;

  return role ? `Northwind ${role}` : "Northwind Demo User";
}

/**
 * The banking skin's `IdentifyRunUser` (server-side). Registered in
 * `src/shell/agent-registry.ts` under the skin id, this is how banking
 * contributes its per-member/role identity scheme to the shared runtime WITHOUT
 * the API route importing anything from `src/skins/**`. The client forwards the
 * active member via CopilotKit `properties` ({ userRole, userId }); this maps
 * them onto the same stable per-user scope the presenter-reset memory helpers
 * use, keeping the agent, the inspector's Memory tab, and a booth reset one
 * source of truth. `properties.userId` is the on-screen member id (mapped by
 * `resolveUserId`), not a raw backend id we would ever trust verbatim.
 */
export function bankingIdentifyUser(
  properties: { userRole?: string; userId?: string } | undefined,
): { id: string; name: string } {
  const input: IdentityInput = {
    memberId: properties?.userId,
    role: properties?.userRole,
  };
  return { id: resolveUserId(input), name: resolveUserName(input) };
}
