import type { AbstractAgent } from "@ag-ui/client";
import { bankingAgent } from "@/skins/banking/agent";
import { airlineAgent } from "@/skins/airline/agent";
import { keelAgent } from "@/skins/keel/agent";
import { airlineIdentifyUser } from "@/skins/airline/intelligence/user-id";
import { bankingIdentifyUser } from "@/skins/banking/intelligence/user-id";
import { keelIdentifyUser } from "@/skins/keel/intelligence/user-id";
import { logisticsAgent } from "@/skins/logistics/agent";
import { logisticsIdentifyUser } from "@/skins/logistics/intelligence/user-id";
import { peopleAgent } from "@/skins/people/agent";
import { peopleIdentifyUser } from "@/skins/people/intelligence/user-id";
import { commerceAgent } from "@/skins/commerce/agent";
import { commerceIdentifyUser } from "@/skins/commerce/intelligence/user-id";
import { bookstoreAgent } from "@/skins/bookstore/agent";
import { bookstoreIdentifyUser } from "@/skins/bookstore/intelligence/user-id";
import { execAgent } from "@/skins/exec/agent";
import { execIdentifyUser } from "@/skins/exec/intelligence/user-id";

/**
 * Server-safe map of skin id → its server-side registration (agent factory +
 * optional identity resolver). Kept separate from the client `registry.ts`
 * (which imports full skin modules with client components) so the API route
 * never pulls client-only code server-side. Each registration MUST be keyed by
 * the same id the client skin uses (=== agentId).
 *
 * This is, together with `registry.ts`, a SANCTIONED composition root — the one
 * place the shell is allowed to reach into a skin's server internals. It exists
 * precisely so the shared API route does NOT have to: identity now lives here,
 * keyed per skin, rather than being hardwired to one skin inside the route.
 */

/**
 * Resolve a stable end-user identity from the client-forwarded run `properties`
 * (`{ userRole, userId }`) for Intelligence thread + durable-memory scoping. A
 * skin supplies this whenever it wants its own scoping scheme — that need not
 * imply per-user memory — a skin may scope threads only. A skin that omits it
 * lets the runtime fall back to a generic identity honouring
 * `INTELLIGENCE_USER_ID` / `INTELLIGENCE_USER_NAME`.
 *
 * Every registered skin supplies one AND uses it for durable memory. Derive that,
 * do not trust this sentence — run, from the app root:
 *
 *     ls src/skins/-/intelligence/user-id.ts        # with - as the glob star
 *     ls src/skins/-/intelligence/seed-memories.ts
 *     ls src/skins/-/intelligence/forget-memories.ts
 *
 * (Written with `-` on purpose: a literal glob star followed by a slash closes
 * this block comment and the rest of the file becomes a syntax error.)
 *
 * Each returns the same set, so the fallback path above is unreachable from the
 * registry today and is kept for skins that do not exist yet. Derive rather than
 * trusting the prose: a per-skin claim here goes false the moment any one skin
 * changes, with nothing to catch it.
 */
export type IdentifyRunUser = (
  properties: { userRole?: string; userId?: string } | undefined,
) => { id: string; name: string };

export interface AgentRegistration {
  /**
   * Factory for this skin's server-only agent.
   *
   * Typed `AbstractAgent` rather than `BuiltInAgent` because the runtime itself
   * is agent-agnostic: `CopilotRuntime`'s `agents` option is
   * `Record<string, AbstractAgent>` and the v2 tree contains no
   * `instanceof BuiltInAgent` branch anywhere.
   *
   * SEVEN skins return a `BuiltInAgent`. `banking` returns an `HttpAgent` — its
   * agent is a Python deep agent in a separate service (see
   * `src/skins/banking/agent.ts` for why the whole agent moved and not just one
   * tool). Narrowing this back to `BuiltInAgent` would reject that registration
   * for a constraint the runtime does not actually have.
   *
   * Derive the split rather than trusting this comment — it goes stale the
   * moment any skin changes:
   *
   *     grep -l "new BuiltInAgent" src/skins/-/agent.ts   # with - as the glob star
   *     grep -l "new HttpAgent"    src/skins/-/agent.ts
   */
  createAgent: () => AbstractAgent;
  /** OPTIONAL per-skin identity resolver (see `IdentifyRunUser`). */
  identifyUser?: IdentifyRunUser;
}

const REGISTRATIONS: Record<string, AgentRegistration> = {
  // Banking scopes Intelligence per member/role (durable memory demo), so it
  // contributes its own resolver — the route no longer knows banking's scheme.
  banking: { createAgent: bankingAgent, identifyUser: bankingIdentifyUser },
  // Aeronova scopes Intelligence per traveller on the account, and unlike
  // logistics and keel it actually USES that scope for durable memory: it ships
  // `intelligence/seed-memories.ts` (beat 4's standing preference, beat 5's
  // cancellation procedure) and `intelligence/forget-memories.ts`, and its
  // `dev/reset` sweeps and re-seeds through them.
  //
  // ⚠ There is one account holder and no switcher — `useAirlineRuntimeProperties`
  // forwards Camila's traveller id unconditionally — so this resolver is not a
  // "switch user and watch memory change" story and must not be presented as one.
  // `src/skins/airline/intelligence/user-id.ts` is the authority on which inputs
  // land in which bucket; read its `memorySeedTargetUserIds` note (and the
  // pinned-`INTELLIGENCE_USER_ID` short-circuit) before changing this.
  airline: { createAgent: airlineAgent, identifyUser: airlineIdentifyUser },
  // Logistics resolves a per-planner identity — `PLANNER_IDENTITY` maps each
  // planner 1:1 — so its Intelligence THREADS are scoped per planner, and it now
  // uses that scope for durable memory too: it ships both
  // `intelligence/seed-memories.ts` (beat 4's preference, beat 5's procedure) and
  // `intelligence/forget-memories.ts`, and its `dev/reset` sweeps and re-seeds
  // through them. It was "identity plumbing only" for two releases, which is the
  // most expensive way to build the hardest half of this and get no demo out of it.
  //
  // ⚠ Same caveat as Rowan, Bellwether and Keel: the client's `properties`
  // frequently do not reach `identifyUser` on a run, so switching planner often
  // re-scopes nothing — which is why the seed targets the default bucket AND the
  // mapped one. Read `intelligence/user-id.ts` before claiming per-planner
  // isolation on stage.
  logistics: {
    createAgent: logisticsAgent,
    identifyUser: logisticsIdentifyUser,
  },
  // Keel scopes Intelligence per persona (privacy/clinical staff), so it
  // contributes its own resolver alongside the agent factory. Unlike logistics
  // it now USES that scope for durable memory: `intelligence/seed-memories.ts`
  // arms beats 4 and 5, and `intelligence/forget-memories.ts` + the gated
  // `POST /api/keel/v1/dev/reset` clear whatever beat 6 taught.
  //
  // ⚠ Same caveat as Rowan and Bellwether: do NOT present this as per-persona
  // memory ISOLATION on stage. The client's `properties` frequently do not reach
  // `identifyUser` on a run, so switching persona in the header often re-scopes
  // nothing — which is exactly why `memorySeedTargetUserIds()` seeds the default
  // bucket AND every persona's. Read `intelligence/user-id.ts` before claiming
  // otherwise.
  keel: { createAgent: keelAgent, identifyUser: keelIdentifyUser },
  // Rowan resolves a per-operator identity — `OPERATOR_IDENTITY` maps each
  // operator 1:1 — and its seeded beat-4 preference and beat-5 procedure are
  // Maya's.
  //
  // ⚠ Same caveat as Bellwether below: do NOT present this as per-operator
  // memory isolation on stage. The client's `properties` frequently do not
  // reach `identifyUser` on a run, so Maya AND Clara both resolve to the same
  // `rowan-demo-user` bucket and switching operator in the sidebar re-scopes
  // NOTHING — the "Clara has taught it nothing" contrast is not demoable until
  // properties forwarding is fixed. That is also why `dev/reset` seeds BOTH the
  // default bucket and Maya's mapped id; see `SEED_TARGET_USER_IDS` in
  // `src/skins/people/intelligence/user-id.ts`, the authority on which inputs
  // land in which bucket.
  people: { createAgent: peopleAgent, identifyUser: peopleIdentifyUser },
  // Bellwether resolves a per-operator identity — `OPERATOR_IDENTITY` maps each
  // operator 1:1 — and its seeded beat-4 preference and beat-5 procedure belong
  // to Nadia.
  //
  // ⚠ Do NOT present that as per-operator memory isolation on stage. The
  // client's `properties` frequently do not reach `identifyUser` on a run, so
  // Nadia AND Theo both resolve to the same `bellwether-demo-user` bucket and
  // switching operator in the sidebar re-scopes NOTHING: the "Theo has taught it
  // nothing" contrast is not demoable until properties forwarding is fixed.
  // `src/skins/commerce/intelligence/user-id.ts` is the authority on which
  // inputs land in which bucket; read its `memorySeedTargetUserIds` note (and
  // the pinned-`INTELLIGENCE_USER_ID` short-circuit) before changing this.
  commerce: { createAgent: commerceAgent, identifyUser: commerceIdentifyUser },
  // Bookstore resolves a per-shopper identity — a known shopper id maps 1:1 onto
  // `bookstore-<id>` — and its seeded beat-4 taste preference is Maya's.
  //
  // ⚠ Same caveat as Rowan and Bellwether above: do NOT present this as
  // per-shopper memory isolation. The client's `properties` frequently do not
  // reach `identifyUser` on a run, so Maya AND Guest both resolve to the same
  // `bookstore-demo-shopper` bucket and the sidebar shopper switcher re-scopes
  // NOTHING — shopping as Guest can recall Maya's preference. What IS demoable is
  // the recall itself: the agent names the remembered taste in `recommendBooks`'
  // `note` slot. That is why `dev/reset` seeds BOTH the default bucket and Maya's
  // mapped id; see `bookstoreMemorySeedTargetUserIds` in
  // `src/skins/bookstore/intelligence/user-id.ts`, the authority on which inputs
  // land in which bucket.
  bookstore: {
    createAgent: bookstoreAgent,
    identifyUser: bookstoreIdentifyUser,
  },
  // Vantage (exec) resolves a per-operator identity for its single on-screen
  // persona — the chief of staff — via `OPERATOR_IDENTITY` mapping
  // `cascade-chief-of-staff` 1:1, and its seeded beat-4 reporting preference is
  // theirs.
  //
  // ⚠ Same caveat as Rowan, Bellwether, Keel and Bookstore above: do NOT
  // present this as per-operator memory isolation on stage. The client's
  // `properties` frequently do not reach `identifyUser` on a run, so runs
  // actually resolve to the `vantage-demo-user` default bucket regardless of
  // the mapped operator —
  // which is exactly why `SEED_TARGET_USER_IDS` seeds BOTH the default bucket
  // AND the mapped chief-of-staff id. Read `intelligence/user-id.ts` before
  // claiming otherwise.
  exec: { createAgent: execAgent, identifyUser: execIdentifyUser },
};

/**
 * The registry, WITHOUT `Object.prototype` behind it.
 *
 * The shared API route indexes this map with a URL-derived id —
 * `agentRegistry[agentId]?.identifyUser`, where `agentId` is parsed out of
 * `request.url` — so the key is attacker-chosen. Indexing a plain object walks
 * the prototype chain: `/constructor`, `/toString`, `/valueOf`,
 * `/hasOwnProperty`, `/__proto__` … all return a truthy INHERITED member, which
 * is the same hazard `getSkin` was fixed for next door in `registry.ts`, on the
 * same ids. `Record<string, AgentRegistration>` does not catch it — the
 * annotation is a claim about the map's own entries, not about what indexing
 * returns.
 *
 * A `getSkin`-style accessor is the sibling's answer because the sibling has
 * exactly one call site to route through. This map does not: the route indexes
 * it directly in two places and builds the runtime's agent map by iterating
 * `agentIds`. Putting the guarantee on the OBJECT covers every index site
 * including the ones already written, rather than covering only the callers
 * that remember to use a helper. `Object.keys`/`Object.entries`/`Object.values`
 * are unaffected — they were never reading the prototype — so `agentIds` below
 * and the suites over it are unchanged. `agent-registry.test.ts` pins the
 * behaviour at the index.
 */
export const agentRegistry: Record<string, AgentRegistration> = Object.assign(
  Object.create(null) as Record<string, AgentRegistration>,
  REGISTRATIONS,
);

export const agentIds = Object.keys(agentRegistry);
