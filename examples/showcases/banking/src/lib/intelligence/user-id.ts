/**
 * Resolve a stable end-user identity for Intelligence requests.
 *
 * Single source of truth shared by the CopilotKit runtime's `identifyUser`
 * (api/copilotkit route) AND the Memory-panel proxy (api/memories), so the chat
 * agent and the inspector always read/write the same per-user memory scope.
 *
 * If `INTELLIGENCE_USER_ID` is pinned (e.g. a seeded local stack that verifies
 * org membership), use it. Otherwise derive a stable `northwind-<role-slug>` so
 * threads and distilled knowledge stay consistent across runs; never mint a
 * random id (that would fragment thread history).
 */
export function resolveUserId(role?: string): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;

  const slug = (role ?? "demo-user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `northwind-${slug || "demo-user"}`;
}

/** The display name to pair with `resolveUserId`. */
export function resolveUserName(role?: string): string {
  const pinnedId = process.env.INTELLIGENCE_USER_ID;
  if (pinnedId) return process.env.INTELLIGENCE_USER_NAME ?? pinnedId;
  return role ? `Northwind ${role}` : "Northwind Demo User";
}
