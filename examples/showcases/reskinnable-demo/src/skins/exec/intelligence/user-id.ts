/**
 * Resolve a stable end-user identity for Vantage's Intelligence requests (thread
 * + durable-memory scoping). SERVER-SAFE: plain .ts, no "use client", no JSX —
 * it is reached through the server-only `src/shell/agent-registry.ts`.
 *
 * Precedence: pinned env > mapped operator id > role-derived > demo default.
 * The pinned env wins so CI (Playwright/aimock) stays deterministic on one
 * seeded identity.
 *
 * The ids are namespaced `vantage-*` rather than reusing another skin's, which
 * matters more here than it looks: the seeded beat-4 preference is whatever
 * standing reporting preference the chief of staff has taught Vantage. If
 * Vantage shared a memory scope with another skin, that preference would
 * surface inside the other skin's answers and the other skin's preference
 * would surface inside Vantage's — and both demos would look like the memory
 * system had confused two products.
 *
 * ⚠ Namespacing the id only isolates `scope: "user"` memories. Verified against
 * the running Intelligence stack: a `scope: "project"` row comes back for EVERY
 * user id in the instance, so project scope is NOT a per-skin boundary when
 * several skins share one backend — which they do locally. That is why Vantage
 * seeds and saves everything at user scope; see intelligence/seed-memories.ts.
 */

import type { IdentifyRunUser } from "@/shell/agent-registry";

/** Operator id -> memory scope. Exec has exactly one on-screen persona — the
 *  chief of staff Vantage is built for — so this is a single-entry map rather
 *  than a roster, kept in the same shape as the other skins' operator maps so
 *  a second persona could be added later without reshaping this module. */
const OPERATOR_IDENTITY: Record<string, { userId: string; userName: string }> =
  {
    "cascade-chief-of-staff": {
      userId: "vantage-chief-of-staff",
      userName: "Cascade Chief of Staff",
    },
  };

export const SEEDED_USER_IDS: readonly string[] = Object.values(
  OPERATOR_IDENTITY,
).map((o) => o.userId);

/**
 * Where memory lands when no operator is mapped and no role is set. Memory
 * taught during a live demo often ends up here, so a presenter reset MUST clear
 * it too — otherwise a previous run's learned procedure survives and a later
 * beat silently starts out already knowing the answer.
 */
export const DEMO_DEFAULT_USER_ID = "vantage-demo-user";

/**
 * The identities the demo's seeded memories are seeded against — BOTH of them,
 * on purpose.
 *
 * This started as just the mapped operator id, and that fails live the same
 * way it failed for people and banking: the agent answers "I didn't have a
 * saved preference from you yet" while the memories sit perfectly well stored
 * under `vantage-chief-of-staff`. Observed in the dev log, runs actually
 * resolve to `vantage-demo-user` — the no-properties fallback — because the
 * client's `properties` are not reaching `identifyUser` on the run path.
 * Banking hit the same thing and settled on seeding its DEFAULT bucket
 * (`northwind-demo-user`), which is what its `dev/reset` does and why its
 * comment says "a lot of demo memory lands here".
 *
 * So: seed the default bucket, because that is where recall actually looks, AND
 * the mapped operator, so the per-operator story is already correct the day the
 * properties path is fixed. Two extra POSTs on reset is a cheap price for a
 * beat that otherwise fails silently and looks like the memory system is
 * broken.
 *
 * ⚠ Until properties forwarding is fixed, this resolves to `vantage-demo-user`
 * on a run regardless of what the client forwards.
 */
export const SEED_TARGET_USER_IDS: readonly string[] = [
  DEMO_DEFAULT_USER_ID,
  OPERATOR_IDENTITY["cascade-chief-of-staff"].userId,
];

export type IdentityInput = { operatorId?: string; role?: string };

function roleSlug(role?: string): string {
  if (!role) return DEMO_DEFAULT_USER_ID;
  const slug = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `vantage-${slug}` : DEMO_DEFAULT_USER_ID;
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
  return role ? `Vantage ${role}` : "Vantage Demo User";
}

/**
 * Vantage's `IdentifyRunUser`, registered in `agent-registry.ts`. The client
 * forwards the active operator through CopilotKit `properties`
 * ({ userRole, userId }); this maps them onto a stable per-operator scope
 * WITHOUT the shared API route importing anything skin-specific.
 */
export const execIdentifyUser: IdentifyRunUser = (properties) => {
  const input: IdentityInput = {
    operatorId: properties?.userId,
    role: properties?.userRole,
  };
  return { id: resolveUserId(input), name: resolveUserName(input) };
};
