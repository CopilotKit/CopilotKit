/**
 * Resolve a stable end-user identity for Aeronova's Intelligence requests
 * (thread + durable-memory scoping). SERVER-SAFE: plain .ts, no "use client",
 * no JSX — it is reached through the server-only `src/shell/agent-registry.ts`.
 *
 * Precedence: pinned env > mapped traveller id > role-derived > demo default.
 * The pinned env wins so CI (Playwright/aimock) stays deterministic on one
 * seeded identity.
 *
 * The ids are namespaced `aeronova-*` rather than reusing another skin's, which
 * matters more than it looks: the seeded beat-4 preference is "aisle, forward of
 * the wing, never Basic Economy, times in her home clock". If Aeronova shared a
 * memory scope with Northwind or Bellwether, that preference would surface inside
 * their answers and theirs inside Aeronova's — and every demo would look like the
 * memory system had confused two products.
 *
 * ⚠ Namespacing the id only isolates `scope: "user"` memories. Verified against
 * the running Intelligence stack (see `intelligence/forget-memories.ts` and
 * `src/skins/commerce/intelligence/user-id.ts`): a `scope: "project"` row comes
 * back for EVERY user id in the instance, so project scope is NOT a per-skin
 * boundary when several skins share one backend — which they do locally. That is
 * why Aeronova seeds and saves everything at user scope; see
 * `intelligence/seed-memories.ts`.
 *
 * ⚠ AERONOVA HAS NO USER SWITCHER, and that is the honest shape rather than an
 * omission. It is one PASSENGER's account — Camila's — with two saved travellers
 * on the profile, not three operators taking turns at a console
 * (`pages/account.tsx` explains at length why the console framing was rejected).
 * So the mapped-traveller branch below exists for the SAME reason logistics' and
 * keel's do — the runtime contract is per-user and the plumbing has to be right —
 * and the identity the client actually forwards is always the account holder's.
 * The companions' rows are what keeps `memoryScopeUserIds()` honest if a later
 * slot ever adds a "book for someone else" mode.
 */

import { seedTravelers } from "../data/trip-seed";

/**
 * The traveller whose scope every run resolves to today: the account holder,
 * DERIVED from the seed rather than restated, so a reseed that moves the holder
 * moves this with it.
 *
 * `?? ""` rather than a non-null assertion: an empty string falls through
 * `resolveUserId`'s `travelerId ? …` guard to the default bucket, which is the
 * bucket the reset seeds anyway. A `!` here would put `undefined` into a `Map.get`
 * and read identically while meaning something worse.
 */
export const ACCOUNT_HOLDER_TRAVELER_ID: string =
  seedTravelers.find((t) => t.accountHolder)?.id ?? "";

/**
 * The role the client forwards alongside the traveller id. One value, because
 * there is one kind of person in this app: a passenger looking at their own
 * account.
 */
export const PASSENGER_ROLE = "passenger";

/**
 * Traveller id (data/trip-seed.ts) → memory scope. 1:1, so two named people never
 * share one scope.
 *
 * A `Map` (not a plain object) is load-bearing for security, exactly as in
 * `src/skins/commerce/intelligence/user-id.ts` and
 * `src/skins/keel/intelligence/user-id.ts`: the key is `properties.userId`,
 * client-forwarded and therefore untrusted. A plain-object lookup walks the
 * prototype chain, so `"toString"`, `"constructor"`, `"valueOf"`, `"__proto__"`,
 * … all resolve TRUTHY, pass the `travelerId && …` guard, and then `.userId` on
 * the inherited member is `undefined`. That is the worst possible outcome for
 * THIS function: it decides the durable-memory scope, so Intelligence would read
 * and write memories under an `undefined` bucket nobody intended — silently — and
 * beats 4, 5 and 6 all depend on that scope being right. `Map.get` only ever sees
 * own entries, so the bad state is unrepresentable rather than guarded per call
 * site. `Record<string, …>` could not catch it: the annotation was a lie about a
 * plain object.
 *
 * BUILT FROM THE SEED, so a traveller added to the roster gets a scope instead of
 * silently falling through to the role slug.
 */
const TRAVELER_IDENTITY: Map<string, { userId: string; userName: string }> =
  new Map(
    seedTravelers.map((t) => [
      t.id,
      {
        // `tv-camila` → `aeronova-camila-rojas`. Slugged from the NAME rather
        // than the id so the bucket is legible in the Intelligence inspector,
        // where a presenter debugging "why did it not remember" reads these.
        userId: `aeronova-${slug(t.name)}`,
        userName: t.name,
      },
    ]),
  );

/**
 * Where memory lands when no traveller is mapped and no role is set. Memory
 * taught during a live demo often ends up here, so a presenter reset MUST clear
 * it too — otherwise a previous run's learned procedure survives and beat 6
 * silently starts out already knowing the answer.
 */
export const DEMO_DEFAULT_USER_ID = "aeronova-demo-user";

export type IdentityInput = { travelerId?: string; role?: string };

/**
 * ASCII-fold before slugging. The roster is Spanish — "Tomás Aguirre", "Inés
 * Vidal" — and a bare `[^a-z0-9]+` strip would turn those into
 * `aeronova-tom-s-aguirre`. Legible in the inspector matters here for the same
 * reason the name-derived id does.
 */
function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function roleSlug(role?: string): string {
  if (!role) return DEMO_DEFAULT_USER_ID;
  const s = slug(role);
  return s ? `aeronova-${s}` : DEMO_DEFAULT_USER_ID;
}

export function resolveUserId({
  travelerId,
  role,
}: IdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;
  const mapped = travelerId ? TRAVELER_IDENTITY.get(travelerId) : undefined;
  if (mapped) return mapped.userId;
  return roleSlug(role);
}

export function resolveUserName({
  travelerId,
  role,
}: IdentityInput = {}): string {
  if (process.env.INTELLIGENCE_USER_ID) {
    return (
      process.env.INTELLIGENCE_USER_NAME ?? process.env.INTELLIGENCE_USER_ID
    );
  }
  const mapped = travelerId ? TRAVELER_IDENTITY.get(travelerId) : undefined;
  if (mapped) return mapped.userName;
  return role ? `Aeronova ${role}` : "Aeronova Demo Passenger";
}

/**
 * ── THE RESET/RUNTIME IDENTITY CONTRACT ────────────────────────────────────
 *
 * Every identity input the runtime can hand `airlineIdentifyUser`, DERIVED from
 * the traveller roster rather than restated here.
 *
 * It exists because commerce's presenter reset used to carry its own hardcoded
 * list of buckets to forget, and that list could not possibly be right — three
 * separate ways, all of them silent. The same three apply verbatim here:
 *
 *  - `resolveUserId` short-circuits on a pinned `INTELLIGENCE_USER_ID`, and
 *    `playwright.config.ts` pins one. A hardcoded list would scrub `aeronova-*`
 *    buckets nothing was using while the run read and wrote the pinned one, so
 *    beats 4/5 would recall nothing AND a procedure taught in beat 6 would
 *    SURVIVE the reset.
 *  - A traveller present in the seed but absent from the map resolves to the role
 *    slug, which a hardcoded list would also lack.
 *  - Nothing forwarded at all resolves to the default bucket.
 */
function possibleIdentityInputs(): readonly IdentityInput[] {
  return [
    // Nothing forwarded. This is the COMMON case on a run, not an edge case:
    // observed in banking, people and commerce, the client's `properties` do not
    // always reach `identifyUser` on the run path, so recall frequently looks at
    // the default bucket rather than the mapped traveller.
    {},
    // One per traveller on the profile, in exactly the shape
    // `useAirlineRuntimeProperties` forwards: { userId, userRole }.
    ...seedTravelers.map((t) => ({
      travelerId: t.id,
      role: PASSENGER_ROLE,
    })),
    // Role forwarded without a recognised traveller id — the role-slug branch.
    { role: PASSENGER_ROLE },
  ];
}

/**
 * Every memory bucket this process's runtime can read or write, in the order the
 * inputs above produce them. The presenter reset forgets exactly this set.
 *
 * Read at CALL time, never frozen into a module constant: the pinned-env branch
 * collapses the whole set to `[pinned]`, and a constant evaluated at import would
 * answer for whatever the env happened to be when the module first loaded.
 */
export function memoryScopeUserIds(): readonly string[] {
  return [
    ...new Set(possibleIdentityInputs().map((input) => resolveUserId(input))),
  ];
}

/**
 * The buckets beat 4's and beat 5's memories are seeded into — the DEFAULT one
 * AND the account holder's, on purpose.
 *
 * Banking, Rowan and Bellwether all hit the same thing and settled here: because
 * runs frequently resolve to the DEFAULT bucket (see `possibleIdentityInputs`),
 * seeding only the mapped traveller leaves recall looking at an empty bucket and
 * beat 4 fails with the concierge cheerfully saying it has no saved preferences —
 * while the memories sit perfectly well stored one id over. So seed the default
 * bucket, because that is where recall actually looks, AND the account holder's,
 * so the per-traveller story is already correct the day the properties path is
 * fixed. Two extra POSTs on reset is a cheap price for a beat that otherwise
 * fails silently and looks like the memory system is broken.
 *
 * Goes through `resolveUserId` for the same reason the forget set does: under a
 * pinned `INTELLIGENCE_USER_ID` both entries collapse onto the pinned bucket,
 * which is the only one the runtime will read.
 */
export function memorySeedTargetUserIds(): readonly string[] {
  return [
    ...new Set([
      resolveUserId({}),
      resolveUserId({
        travelerId: ACCOUNT_HOLDER_TRAVELER_ID,
        role: PASSENGER_ROLE,
      }),
    ]),
  ];
}

/**
 * Aeronova's `IdentifyRunUser`, registered in `agent-registry.ts`. The client
 * forwards the account holder through CopilotKit `properties`
 * ({ userRole, userId }); this maps them onto a stable scope WITHOUT the shared
 * API route importing anything skin-specific.
 */
export function airlineIdentifyUser(
  properties: { userRole?: string; userId?: string } | undefined,
): { id: string; name: string } {
  const input: IdentityInput = {
    travelerId: properties?.userId,
    role: properties?.userRole,
  };
  return { id: resolveUserId(input), name: resolveUserName(input) };
}
