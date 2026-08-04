/**
 * Resolve a stable end-user identity for Intelligence requests in the keel skin.
 *
 * SERVER-SAFE: no "use client", no JSX, no .tsx imports — reached through the
 * server-only agent registry, so it must never pull client code server-side.
 * `IdentifyRunUser` is imported as a type (erased at compile time), so the
 * agent-registry module's runtime graph is not dragged in.
 *
 * Precedence mirrors banking: pinned env > mapped persona id > role-derived >
 * demo default.
 *  - Pinned `INTELLIGENCE_USER_ID` wins so CI (Playwright/aimock, smokes) stays
 *    deterministic on a single seeded identity.
 *  - Unpinned, the client forwards the active persona via CopilotKit
 *    `properties` ({ userRole, userId }); `userId` is the persona id, which we
 *    scope 1:1 onto `keel-<id>` so two on-screen personas never share a memory.
 */

import type { IdentifyRunUser } from "@/shell/agent-registry";
import { KEEL_PERSONAS } from "@/skins/keel/data/personas";

/**
 * Persona id -> display name, derived from the frozen persona roster.
 *
 * A `Map` (not a plain object) is load-bearing for security: `userId` is
 * untrusted client-forwarded input, and a plain-object lookup (`obj[userId]`)
 * walks the prototype chain, so inherited keys like `"constructor"`,
 * `"toString"`, or `"__proto__"` resolve truthy and would spoof a persona
 * (minting a bogus memory scope, or returning a function where a name string
 * is declared). `Map.has`/`Map.get` only ever see own entries, making that
 * bad state unrepresentable rather than relying on a per-call-site guard.
 */
const PERSONA_NAME: Map<string, string> = new Map(
  KEEL_PERSONAS.map((p) => [p.id, p.name] as const),
);

/** The fallback scope used when no persona and no role are forwarded. */
export const DEMO_DEFAULT_USER_ID = "keel-demo-user";

export type KeelIdentityInput = { userId?: string; userRole?: string };

function roleSlug(role?: string): string {
  return (role ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function resolveKeelUserId({
  userId,
  userRole,
}: KeelIdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;

  if (userId && PERSONA_NAME.has(userId)) return `keel-${userId}`;

  const slug = roleSlug(userRole);
  return slug ? `keel-${slug}` : DEMO_DEFAULT_USER_ID;
}

export function resolveKeelUserName({
  userId,
  userRole,
}: KeelIdentityInput = {}): string {
  const pinnedId = process.env.INTELLIGENCE_USER_ID;
  if (pinnedId) return process.env.INTELLIGENCE_USER_NAME ?? pinnedId;

  const personaName = userId ? PERSONA_NAME.get(userId) : undefined;
  if (personaName) return personaName;
  return userRole ? `Keel ${userRole}` : "Keel Demo User";
}

/**
 * Keel's `IdentifyRunUser` (server-side). Registered in
 * `src/shell/agent-registry.ts` under the skin id, this maps the
 * client-forwarded run `properties` ({ userRole, userId }) onto a stable
 * per-persona memory scope WITHOUT the API route importing anything from
 * `src/skins/**`. The client half is `KeelRuntimeProviders` +
 * `useKeelRuntimeProperties` (providers.tsx).
 */
export const keelIdentifyUser: IdentifyRunUser = (properties) => {
  const input: KeelIdentityInput = {
    userId: properties?.userId,
    userRole: properties?.userRole,
  };
  return { id: resolveKeelUserId(input), name: resolveKeelUserName(input) };
};
