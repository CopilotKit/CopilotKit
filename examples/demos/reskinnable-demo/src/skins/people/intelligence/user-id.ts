/**
 * Resolve a stable end-user identity for Rowan's Intelligence requests (thread
 * + durable-memory scoping). SERVER-SAFE: plain .ts, no "use client", no JSX —
 * it is reached through the server-only `src/shell/agent-registry.ts`.
 *
 * Precedence: pinned env > mapped operator id > role-derived > demo default.
 * The pinned env wins so CI (Playwright/aimock) stays deterministic on one
 * seeded identity.
 *
 * The ids are namespaced `rowan-*` rather than reusing another skin's, which
 * matters more here than it looks: the seeded beat-4 preference is "review comp
 * by level, out-of-band first". If Rowan shared a memory scope with banking,
 * that preference would surface inside banking's spend answers and banking's
 * spend preference would surface inside Rowan's — and both demos would look
 * like the memory system had confused two products.
 *
 * ⚠ Namespacing the id only isolates `scope: "user"` memories. Verified against
 * the running Intelligence stack: a `scope: "project"` row comes back for EVERY
 * user id in the instance, so project scope is NOT a per-skin boundary when
 * several skins share one backend — which they do locally. That is why Rowan
 * seeds and saves everything at user scope; see intelligence/seed-memories.ts.
 */

/** Operator id (data/seed.ts) → memory scope. 1:1, so two on-screen people
 *  never share one scope. Maya is the seeded persona the demo runs as; Clara is
 *  deliberately a colleague Rowan has NOT learned anything from yet. */
const OPERATOR_IDENTITY: Record<string, { userId: string; userName: string }> =
  {
    "op-maya": { userId: "rowan-maya-lindqvist", userName: "Maya Lindqvist" },
    "op-clara": { userId: "rowan-clara-mendes", userName: "Clara Mendes" },
  };

export const SEEDED_USER_IDS: readonly string[] = Object.values(
  OPERATOR_IDENTITY,
).map((o) => o.userId);

/**
 * Where memory lands when no operator is mapped and no role is set. Memory
 * taught during a live demo often ends up here, so a presenter reset MUST clear
 * it too — otherwise a previous run's learned procedure survives and beat 6
 * silently starts out already knowing the answer.
 */
export const DEMO_DEFAULT_USER_ID = "rowan-demo-user";

/**
 * The identities beat 4's and beat 5's memories are seeded against — BOTH of
 * them, on purpose.
 *
 * This started as just the mapped operator id, and beat 4 failed live: the
 * agent answered "I didn't have a saved format from you yet" while the memories
 * sat perfectly well stored under `rowan-maya-lindqvist`. Observed in the dev
 * log, runs actually resolve to `rowan-demo-user` — the no-properties fallback
 * — because the client's `properties` are not reaching `identifyUser` on the
 * run path. Banking hit the same thing and settled on seeding its DEFAULT
 * bucket (`northwind-demo-user`), which is what its `dev/reset` does and why
 * its comment says "a lot of demo memory lands here".
 *
 * So: seed the default bucket, because that is where recall actually looks, AND
 * the mapped operator, so the per-operator story is already correct the day the
 * properties path is fixed. Two extra POSTs on reset is a cheap price for a
 * beat that otherwise fails silently and looks like the memory system is broken.
 *
 * ⚠ Until properties forwarding is fixed, switching operator in the sidebar does
 * NOT re-scope memory — Maya and Clara both resolve to `rowan-demo-user` on a
 * run. The "Clara has taught it nothing" contrast is not demoable yet.
 */
export const SEED_TARGET_USER_IDS: readonly string[] = [
  DEMO_DEFAULT_USER_ID,
  OPERATOR_IDENTITY["op-maya"].userId,
];

export type IdentityInput = { operatorId?: string; role?: string };

function roleSlug(role?: string): string {
  if (!role) return DEMO_DEFAULT_USER_ID;
  const slug = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `rowan-${slug}` : DEMO_DEFAULT_USER_ID;
}

export function resolveUserId({
  operatorId,
  role,
}: IdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;
  if (operatorId && OPERATOR_IDENTITY[operatorId])
    return OPERATOR_IDENTITY[operatorId].userId;
  return roleSlug(role);
}

export function resolveUserName({
  operatorId,
  role,
}: IdentityInput = {}): string {
  if (process.env.INTELLIGENCE_USER_ID) {
    return (
      process.env.INTELLIGENCE_USER_NAME ?? process.env.INTELLIGENCE_USER_ID
    );
  }
  if (operatorId && OPERATOR_IDENTITY[operatorId])
    return OPERATOR_IDENTITY[operatorId].userName;
  return role ? `Rowan ${role}` : "Rowan Demo User";
}

/**
 * Rowan's `IdentifyRunUser`, registered in `agent-registry.ts`. The client
 * forwards the active operator through CopilotKit `properties`
 * ({ userRole, userId }); this maps them onto a stable per-operator scope
 * WITHOUT the shared API route importing anything skin-specific.
 */
export function peopleIdentifyUser(
  properties: { userRole?: string; userId?: string } | undefined,
): { id: string; name: string } {
  const input: IdentityInput = {
    operatorId: properties?.userId,
    role: properties?.userRole,
  };
  return { id: resolveUserId(input), name: resolveUserName(input) };
}
