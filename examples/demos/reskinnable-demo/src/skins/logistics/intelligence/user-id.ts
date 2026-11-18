/**
 * Resolve a stable end-user identity for Intelligence requests (thread +
 * durable-memory scoping). SERVER-SAFE: plain .ts, no "use client", no JSX.
 *
 * Precedence: pinned env > mapped planner id > role-derived > demo default.
 * The pinned env wins so CI (Playwright/aimock) stays deterministic on one
 * seeded identity.
 */

import seed from "../data/seed.json";

/**
 * Planner id (seed.json) -> memory scope. Kept 1:1 so two on-screen people
 * never share one memory scope.
 *
 * A `Map`, not a plain object, and that is load-bearing rather than taste — the
 * same rule `src/skins/commerce/intelligence/user-id.ts` and
 * `src/skins/keel/intelligence/user-id.ts` already follow. The key is
 * `properties.userId`, which is client-forwarded and therefore untrusted: a
 * plain-object lookup walks the prototype chain, so `"toString"`,
 * `"constructor"`, `"valueOf"`, `"__proto__"` all resolve TRUTHY, pass a
 * `plannerId && …` guard, and then yield `undefined` for `.userId`. This
 * function decides the DURABLE-MEMORY scope, so that would have Intelligence
 * reading and writing under a bucket nobody intended, silently — and beats 4 and
 * 5 are exactly the beats that depend on the scope being right. `Map.get` only
 * ever sees own entries, so the bad state is unrepresentable rather than guarded
 * per call site.
 */
const PLANNER_IDENTITY: Map<string, { userId: string; userName: string }> =
  new Map([
    ["pl-rosa", { userId: "rosa-delgado", userName: "Rosa Delgado" }],
    ["pl-ibrahim", { userId: "ibrahim-okonjo", userName: "Ibrahim Okonjo" }],
  ]);

export const SEEDED_USER_IDS: readonly string[] = [
  ...PLANNER_IDENTITY.values(),
].map((p) => p.userId);

export const DEMO_DEFAULT_USER_ID = "meridian-demo-user";

/**
 * The planner the demo runs as — Rosa, the one whose reading preference beat 4
 * recalls and whose procedure beat 5 replays. Read off the seed rather than
 * restated, so a re-seeded roster cannot leave this pointing at nobody.
 */
export const DEFAULT_PLANNER_ID = "pl-rosa";

/** The on-screen roster, as `{ id, role }` — the only two fields identity uses. */
const SEED_PLANNERS: readonly { id: string; role: string }[] =
  seed.planners.map((p) => ({ id: p.id, role: p.role }));

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
  const mapped = plannerId ? PLANNER_IDENTITY.get(plannerId) : undefined;
  if (mapped) return mapped.userId;
  return roleSlug(role);
}

/**
 * ── THE RESET/RUNTIME IDENTITY CONTRACT ────────────────────────────────────
 *
 * Every identity input the runtime can hand `logisticsIdentifyUser`, DERIVED
 * from the planner roster in `data/seed.json` rather than restated here.
 *
 * This exists because a presenter reset that carries its own hardcoded list of
 * buckets to forget and re-seed cannot possibly be right, and every way it is
 * wrong is SILENT — the reset returns `ok: true` with a plausible count and the
 * demo quietly proves nothing:
 *
 *  - `resolveUserId` short-circuits on a pinned `INTELLIGENCE_USER_ID`, and
 *    `playwright.config.ts` pins one. A hardcoded list would scrub `meridian-*`
 *    buckets nothing is reading while the run reads and writes the pinned one.
 *  - A planner present in the roster but absent from `PLANNER_IDENTITY` resolves
 *    to a `meridian-<role>` slug, which a hand-written list would also lack.
 *
 * So the reset ASKS this module which buckets exist, and there is exactly one
 * copy of the answer.
 */
function possibleIdentityInputs(): readonly IdentityInput[] {
  return [
    // Nothing forwarded. This is the COMMON case on a run, not an edge case:
    // the client's `properties` do not always reach `identifyUser` on the run
    // path, so recall frequently looks at the default bucket rather than the
    // mapped planner. Banking, Rowan and Bellwether all measured the same thing.
    {},
    // One per on-screen planner, in exactly the shape
    // `useLogisticsRuntimeProperties` forwards: { userId, userRole }. A mapped
    // planner yields their 1:1 scope; an UNMAPPED one falls through to its role
    // slug, and deriving from the roster is what keeps that covered when someone
    // adds a planner to `seed.json` and forgets `PLANNER_IDENTITY`.
    ...SEED_PLANNERS.map((p) => ({ plannerId: p.id, role: p.role })),
    // Role forwarded without a recognised planner id — the role-slug branch.
    ...SEED_PLANNERS.map((p) => ({ role: p.role })),
  ];
}

/**
 * Every memory bucket this process's runtime can read or write. The presenter
 * reset forgets exactly this set.
 *
 * Read at CALL time, never frozen into a module constant: the pinned-env branch
 * collapses the whole set to `[pinned]`, and a constant evaluated at import
 * would answer for whatever the env happened to be when the module first loaded.
 */
export function memoryScopeUserIds(): readonly string[] {
  return [
    ...new Set(possibleIdentityInputs().map((input) => resolveUserId(input))),
  ];
}

/**
 * The buckets beat 4's and beat 5's memories are seeded into — the DEFAULT one
 * AND the seeded planner's, on purpose.
 *
 * Banking, Rowan and Bellwether all landed here for the same measured reason:
 * because runs frequently resolve to the default bucket (see
 * `possibleIdentityInputs`), seeding only the mapped planner leaves recall
 * looking at an empty bucket, and beat 4 fails with the agent cheerfully saying
 * it has no saved format — while the memories sit perfectly well stored one id
 * over. So seed the default bucket, because that is where recall actually looks,
 * AND the mapped planner, so the per-planner story is already correct the day
 * the properties path is fixed.
 *
 * Goes through `resolveUserId` for the same reason the forget set does: under a
 * pinned `INTELLIGENCE_USER_ID` both entries collapse onto the pinned bucket,
 * which is the only one the runtime will read.
 *
 * ⚠ Until properties forwarding is fixed, switching planner in the sidebar does
 * NOT re-scope memory — Rosa and Ibrahim both resolve to `meridian-demo-user` on
 * a run. Do not write anything claiming per-planner memory is demoable.
 */
export function memorySeedTargetUserIds(): readonly string[] {
  const seededPlanner = SEED_PLANNERS.find((p) => p.id === DEFAULT_PLANNER_ID);
  return [
    ...new Set([
      resolveUserId({}),
      resolveUserId({
        plannerId: DEFAULT_PLANNER_ID,
        role: seededPlanner?.role,
      }),
    ]),
  ];
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
  const mapped = plannerId ? PLANNER_IDENTITY.get(plannerId) : undefined;
  if (mapped) return mapped.userName;
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
