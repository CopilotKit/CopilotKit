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

/**
 * ── THE RESET/RUNTIME IDENTITY CONTRACT ────────────────────────────────────
 *
 * Every identity input the runtime can hand `keelIdentifyUser`, DERIVED from the
 * persona roster rather than restated. The presenter reset asks THIS module which
 * buckets exist so the two cannot drift, exactly as commerce's reset does
 * (`src/skins/commerce/intelligence/user-id.ts` states the three silent failures
 * a hardcoded list produced there — all three apply here verbatim).
 *
 * Read at CALL time, never frozen into a module constant: the pinned-env branch
 * in `resolveKeelUserId` collapses the whole set to `[pinned]`, and a constant
 * evaluated at import would answer for whatever the env happened to be when the
 * module first loaded. `playwright.config.ts` pins `INTELLIGENCE_USER_ID`, so
 * that branch is live in CI rather than hypothetical.
 */
function possibleIdentityInputs(): readonly KeelIdentityInput[] {
  return [
    // Nothing forwarded. This is the COMMON case on a run, not an edge case:
    // observed across banking, Rowan and Bellwether, the client's `properties`
    // do not reliably reach `identifyUser` on the run path, so recall frequently
    // looks at the DEFAULT bucket rather than at the mapped persona's.
    {},
    // One per on-screen persona, in exactly the shape
    // `useKeelRuntimeProperties` forwards: { userId, userRole }.
    ...KEEL_PERSONAS.map((p) => ({ userId: p.id, userRole: p.role })),
    // Role forwarded without a recognised persona id — the role-slug branch.
    ...KEEL_PERSONAS.map((p) => ({ userRole: p.role })),
  ];
}

/**
 * Every memory bucket this process's runtime can read or write. The presenter
 * reset forgets exactly this set.
 */
export function memoryScopeUserIds(): readonly string[] {
  return [
    ...new Set(
      possibleIdentityInputs().map((input) => resolveKeelUserId(input)),
    ),
  ];
}

/**
 * The buckets beats 4 and 5 are seeded into: the DEFAULT one and EVERY mapped
 * persona's.
 *
 * Two decisions, both load-bearing:
 *
 *  1. THE DEFAULT BUCKET IS SEEDED. Banking, Rowan and Bellwether each hit the
 *     same wall: because runs frequently resolve to the default (see
 *     `possibleIdentityInputs`), seeding only the mapped persona leaves recall
 *     looking at an empty bucket, and beat 4 fails with the agent cheerfully
 *     saying it has no saved format — while the memories sit perfectly well
 *     stored one id over. That failure is silent and looks like a broken memory
 *     system.
 *  2. EVERY PERSONA, DERIVED FROM THE ROSTER, not just the default one. Keel's
 *     role switcher is a first-class demo affordance sitting in the header, and a
 *     presenter WILL touch it — Sam Okafor is the knowledge/ops lead the beat map
 *     writes beat 4 for, while `DEFAULT_PERSONA_ID` opens the app as Ana Reyes.
 *     Seeding one of the two would make the beat depend on which name is showing.
 *     Deriving from `KEEL_PERSONAS` also means a persona added later cannot be
 *     forgotten here.
 *
 * Because the memories land in every persona's bucket, their TEXT is written for
 * the DESK rather than addressed to a named person — see `seed-memories.ts`. A
 * preference that said "when Sam asks…" would be recalled while Ana is on screen
 * and read as the memory system confusing two people.
 *
 * Goes through `resolveKeelUserId` for the same reason the forget set does: under
 * a pinned `INTELLIGENCE_USER_ID` every entry collapses onto the pinned bucket,
 * which is the only one the runtime will read.
 */
export function memorySeedTargetUserIds(): readonly string[] {
  return [
    ...new Set([
      resolveKeelUserId({}),
      ...KEEL_PERSONAS.map((p) =>
        resolveKeelUserId({ userId: p.id, userRole: p.role }),
      ),
    ]),
  ];
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
