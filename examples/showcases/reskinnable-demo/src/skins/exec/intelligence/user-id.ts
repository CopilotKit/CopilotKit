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

interface OperatorIdentity {
  userId: string;
  userName: string;
}

/** The one on-screen persona Vantage is built for. Named separately from the
 *  map below so `SEED_TARGET_USER_IDS` can reference its id without a
 *  non-null-asserted `Map.get`. */
const CHIEF_OF_STAFF: OperatorIdentity = {
  userId: "vantage-chief-of-staff",
  userName: "Cascade Chief of Staff",
};

/**
 * Operator id -> memory scope. Exec has exactly one on-screen persona, so this
 * is a single-entry map rather than a roster, kept in the same shape as the
 * other skins' operator maps so a second persona could be added later without
 * reshaping this module.
 *
 * A `Map` (not a plain object) is load-bearing for security, exactly as in
 * `src/skins/keel/intelligence/user-id.ts` and
 * `src/skins/commerce/intelligence/user-id.ts`: the key is
 * `properties.userId`, client-forwarded and therefore untrusted. A plain-object
 * lookup walks the PROTOTYPE CHAIN, so `"toString"`, `"constructor"`,
 * `"valueOf"`, `"__proto__"`, … all resolve TRUTHY, pass the `operatorId && …`
 * guard, and then `.userId` / `.userName` on the inherited member is
 * `undefined`. That is the worst possible outcome for THIS function: it decides
 * the durable-memory scope, so Intelligence would read and write memories under
 * an `undefined` bucket nobody intended — and no `dev/reset` sweep would ever
 * clear it, which is precisely how beat 6 starts out already taught.
 * `Map.get` only ever sees own entries, so the bad state is unrepresentable
 * rather than guarded per call site. `Record<string, …>` could not catch it:
 * the annotation was a lie about a plain object.
 */
const OPERATOR_IDENTITY: Map<string, OperatorIdentity> = new Map([
  ["cascade-chief-of-staff", CHIEF_OF_STAFF],
]);

/**
 * Every MAPPED-OPERATOR bucket, for `dev/reset` to SWEEP.
 *
 * ⚠ THE NAME IS A CROSS-SKIN CONVENTION, NOT A DESCRIPTION. This is the FORGET
 * list, not the seed list: `dev/reset` clears `[...SEEDED_USER_IDS,
 * DEMO_DEFAULT_USER_ID]` and then seeds {@link SEED_TARGET_USER_IDS}, which is
 * a different set (it includes the demo default, because that is where runs
 * actually land). The two diverged once people and commerce started seeding
 * their default bucket, and the name kept the shape every other skin's route
 * imports — renaming it here alone would only make exec the odd one out. Read
 * it as "the ids the reset knows about", and see `SEED_TARGET_USER_IDS` for
 * what is actually written.
 *
 * Together with `DEMO_DEFAULT_USER_ID` this must COVER every id
 * {@link resolveUserId} can return for any input — a reachable bucket outside
 * the pair is one the reset skips forever, and beat 6 opens already taught.
 * That is why the role branch below resolves only KNOWN roles; the invariant is
 * pinned in `user-id.test.ts`.
 */
export const SEEDED_USER_IDS: readonly string[] = [
  ...OPERATOR_IDENTITY.values(),
].map((o) => o.userId);

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
  CHIEF_OF_STAFF.userId,
];

export type IdentityInput = { operatorId?: string; role?: string };

/**
 * Role slug -> memory scope, for the roles this skin actually forwards
 * (`../runtime-properties.ts` sends `userRole: "chief-of-staff"`).
 *
 * ── WHY AN ALLOW-LIST, AND NOT A MINTED SLUG ────────────────────────────────
 * This branch used to build a bucket out of whatever the role slugged to:
 * `"Board Secretary"` became `vantage-board-secretary`, a real scope
 * Intelligence reads and writes. `userRole` is client-forwarded and therefore
 * UNTRUSTED, so that made the set of live memory buckets unbounded and
 * caller-chosen — while `dev/reset`'s sweep list is STATIC
 * ({@link SEEDED_USER_IDS} + {@link DEMO_DEFAULT_USER_ID}). Any minted bucket
 * was therefore a bucket no reset has ever cleared, and memory taught into one
 * survives forever: exactly the "beat 6 starts out already taught" failure the
 * reset exists to prevent, with nothing on screen saying so.
 *
 * An unknown role now falls through to the demo default — a bucket the reset
 * DOES sweep — so `resolveUserId`'s range is closed and coverage is testable
 * rather than argued. A second persona is added by adding a row here (and to
 * {@link OPERATOR_IDENTITY}), which is also what puts it in the sweep list.
 *
 * A `Map`, for the same untrusted-key reason as `OPERATOR_IDENTITY` above.
 */
const ROLE_IDENTITY: Map<string, OperatorIdentity> = new Map([
  ["chief-of-staff", CHIEF_OF_STAFF],
]);

/**
 * Normalise a role the way the map's keys are written, so casing and spacing
 * (`"Chief of Staff"`, `"CHIEF-OF-STAFF"`) do not fork one person into two
 * scopes. Returns `""` for a role with no alphanumerics at all, which no key
 * matches.
 */
function roleSlug(role: string): string {
  return role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** The identity behind `operatorId` OR `role`, in that precedence, if any. */
function lookupIdentity({
  operatorId,
  role,
}: IdentityInput): OperatorIdentity | undefined {
  const mapped = operatorId ? OPERATOR_IDENTITY.get(operatorId) : undefined;
  if (mapped) return mapped;
  return role ? ROLE_IDENTITY.get(roleSlug(role)) : undefined;
}

export function resolveUserId(input: IdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;
  return lookupIdentity(input)?.userId ?? DEMO_DEFAULT_USER_ID;
}

export function resolveUserName(input: IdentityInput = {}): string {
  if (process.env.INTELLIGENCE_USER_ID) {
    return (
      process.env.INTELLIGENCE_USER_NAME ?? process.env.INTELLIGENCE_USER_ID
    );
  }
  // The name tracks the ID: an unrecognised role lands in the demo-default
  // BUCKET, so labelling it `Vantage <whatever the client sent>` would put an
  // arbitrary client string on memories stored under the shared default.
  return lookupIdentity(input)?.userName ?? "Vantage Demo User";
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
