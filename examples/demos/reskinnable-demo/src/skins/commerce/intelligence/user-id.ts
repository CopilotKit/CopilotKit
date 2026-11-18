/**
 * Resolve a stable end-user identity for Bellwether's Intelligence requests
 * (thread + durable-memory scoping). SERVER-SAFE: plain .ts, no "use client",
 * no JSX — it is reached through the server-only `src/shell/agent-registry.ts`.
 *
 * Precedence: pinned env > mapped operator id > role-derived > demo default.
 * The pinned env wins so CI (Playwright/aimock) stays deterministic on one
 * seeded identity.
 *
 * The ids are namespaced `bellwether-*` rather than reusing another skin's,
 * which matters more here than it looks: the seeded beat-4 preference is "review
 * margin by category, below-floor first". If Bellwether shared a memory scope
 * with Rowan, that preference would surface inside Rowan's compensation answers
 * and Rowan's would surface inside Bellwether's — and both demos would look like
 * the memory system had confused two products.
 *
 * ⚠ Namespacing the id only isolates `scope: "user"` memories. Verified against
 * the running Intelligence stack: a `scope: "project"` row comes back for EVERY
 * user id in the instance, so project scope is NOT a per-skin boundary when
 * several skins share one backend — which they do locally. That is why
 * Bellwether seeds and saves everything at user scope; see
 * `intelligence/seed-memories.ts`.
 */

import { DEFAULT_OPERATOR_ID, SEED_OPERATORS } from "../data/seed";

/**
 * Operator id (data/seed.ts) → memory scope. 1:1, so two on-screen people never
 * share one scope. Nadia is the seeded persona the demo runs as; Theo is
 * deliberately a colleague Bellwether has NOT learned anything from yet.
 *
 * A `Map` (not a plain object) is load-bearing for security, exactly as in
 * `src/skins/keel/intelligence/user-id.ts` and `src/skins/commerce/data/http.ts`:
 * the key is `properties.userId`, client-forwarded and therefore untrusted. A
 * plain-object lookup walks the prototype chain, so `"toString"`,
 * `"constructor"`, `"valueOf"`, `"__proto__"`, … all resolve TRUTHY, pass the
 * `operatorId && …` guard, and then `.userId` / `.userName` on the inherited
 * member is `undefined`. That is the worst possible outcome for THIS function:
 * it decides the durable-memory scope, so Intelligence would read and write
 * memories under an `undefined` bucket nobody intended — silently — and the
 * memory-recall and stored-procedure beats depend on that scope being right.
 * `Map.get` only ever sees own entries, so the bad state is unrepresentable
 * rather than guarded per call site. `Record<string, …>` could not catch it: the
 * annotation was a lie about a plain object.
 */
const OPERATOR_IDENTITY: Map<string, { userId: string; userName: string }> =
  new Map([
    [
      "op-nadia",
      { userId: "bellwether-nadia-okonjo", userName: "Nadia Okonjo" },
    ],
    ["op-theo", { userId: "bellwether-theo-vance", userName: "Theo Vance" }],
  ]);

/**
 * Where memory lands when no operator is mapped and no role is set. Memory
 * taught during a live demo often ends up here, so a presenter reset MUST clear
 * it too — otherwise a previous run's learned procedure survives and beat 6
 * silently starts out already knowing the answer.
 */
export const DEMO_DEFAULT_USER_ID = "bellwether-demo-user";

export type IdentityInput = { operatorId?: string; role?: string };

function roleSlug(role?: string): string {
  if (!role) return DEMO_DEFAULT_USER_ID;
  const slug = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `bellwether-${slug}` : DEMO_DEFAULT_USER_ID;
}

export function resolveUserId({
  operatorId,
  role,
}: IdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;
  const mapped = operatorId ? OPERATOR_IDENTITY.get(operatorId) : undefined;
  if (mapped) return mapped.userId;
  return roleSlug(role);
}

/**
 * ── THE RESET/RUNTIME IDENTITY CONTRACT ────────────────────────────────────
 *
 * Every identity input the runtime can hand `commerceIdentifyUser`, DERIVED from
 * the operator roster in `data/seed.ts` rather than restated here.
 *
 * This function exists because the presenter reset used to carry its own
 * hardcoded list of buckets to forget and re-seed, and that list could not
 * possibly be right:
 *
 *  - `resolveUserId` short-circuits on a pinned `INTELLIGENCE_USER_ID`, and
 *    `playwright.config.ts` pins it to banking's `jordan-beamson`. So every e2e
 *    commerce run read and wrote BANKING's memory bucket while the reset scrubbed
 *    three `bellwether-*` buckets nothing was using — beats 4/5 recalled nothing,
 *    and a procedure taught in beat 6 SURVIVED the reset.
 *  - An operator present in the roster but absent from `OPERATOR_IDENTITY`
 *    resolves to a `bellwether-<role>` slug, which the hardcoded list also
 *    lacked.
 *
 * All three failures are silent: the reset returns `ok: true` with a plausible
 * `forgot` count and the demo just quietly proves nothing. So the reset now asks
 * THIS module which buckets exist, and there is exactly one copy of the answer.
 */
function possibleIdentityInputs(): readonly IdentityInput[] {
  return [
    // Nothing forwarded. This is the COMMON case on a run, not an edge case:
    // observed in the dev log, the client's `properties` do not always reach
    // `identifyUser` on the run path, so recall frequently looks at the default
    // bucket rather than the mapped operator.
    {},
    // One per on-screen operator, in exactly the shape
    // `useCommerceRuntimeProperties` forwards: { userId, userRole }. Mapped
    // operators yield their 1:1 scope; an UNMAPPED one falls through to its role
    // slug, and deriving from the roster is what keeps that covered when someone
    // adds an operator to `seed.ts` and forgets `OPERATOR_IDENTITY`.
    ...SEED_OPERATORS.map((o) => ({ operatorId: o.id, role: o.role })),
    // Role forwarded without a recognised operator id — the role-slug branch.
    ...SEED_OPERATORS.map((o) => ({ role: o.role })),
  ];
}

/**
 * Every memory bucket this process's runtime can read or write, in the order the
 * inputs above produce them. The presenter reset forgets exactly this set.
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
 * The buckets beat 4's and beat 5's memories are seeded into — the default one
 * AND the seeded operator's, on purpose.
 *
 * Banking and Rowan both hit the same thing and settled here: because runs
 * frequently resolve to the DEFAULT bucket (see `possibleIdentityInputs`),
 * seeding only the mapped operator leaves recall looking at an empty bucket and
 * beat 4 fails with the agent cheerfully saying it has no saved format — while
 * the memories sit perfectly well stored one id over. So seed the default
 * bucket, because that is where recall actually looks, AND the mapped operator,
 * so the per-operator story is already correct the day the properties path is
 * fixed. Two extra POSTs on reset is a cheap price for a beat that otherwise
 * fails silently and looks like the memory system is broken.
 *
 * Goes through `resolveUserId` for the same reason the forget set does: under a
 * pinned `INTELLIGENCE_USER_ID` both entries collapse onto the pinned bucket,
 * which is the only one the runtime will read.
 *
 * ⚠ Until properties forwarding is fixed, switching operator in the sidebar does
 * NOT re-scope memory — Nadia and Theo both resolve to `bellwether-demo-user` on
 * a run. The "Theo has taught it nothing" contrast is not demoable yet.
 */
export function memorySeedTargetUserIds(): readonly string[] {
  const seededOperator = SEED_OPERATORS.find(
    (o) => o.id === DEFAULT_OPERATOR_ID,
  );
  return [
    ...new Set([
      resolveUserId({}),
      resolveUserId({
        operatorId: DEFAULT_OPERATOR_ID,
        role: seededOperator?.role,
      }),
    ]),
  ];
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
  const mapped = operatorId ? OPERATOR_IDENTITY.get(operatorId) : undefined;
  if (mapped) return mapped.userName;
  return role ? `Bellwether ${role}` : "Bellwether Demo User";
}

/**
 * Bellwether's `IdentifyRunUser`, registered in `agent-registry.ts`. The client
 * forwards the active operator through CopilotKit `properties`
 * ({ userRole, userId }); this maps them onto a stable per-operator scope
 * WITHOUT the shared API route importing anything skin-specific.
 */
export function commerceIdentifyUser(
  properties: { userRole?: string; userId?: string } | undefined,
): { id: string; name: string } {
  const input: IdentityInput = {
    operatorId: properties?.userId,
    role: properties?.userRole,
  };
  return { id: resolveUserId(input), name: resolveUserName(input) };
}
