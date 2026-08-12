import type { BuiltInAgent } from "@copilotkit/runtime/v2";
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
 * As of the beat-parity work, ALL SIX skins supply one AND use it for durable
 * memory. Derive that, do not trust this sentence — run, from the app root:
 *
 *     ls src/skins/-/intelligence/user-id.ts        # with - as the glob star
 *     ls src/skins/-/intelligence/seed-memories.ts
 *     ls src/skins/-/intelligence/forget-memories.ts
 *
 * (Written with `-` on purpose: a literal glob star followed by a slash closes
 * this block comment and the rest of the file becomes a syntax error. That is
 * not a hypothetical either — this very paragraph did it once.)
 *
 * Each returns all six. Derive rather than trusting the prose because —
 * two parallel agents each hand-edited this paragraph in the same hour and BOTH
 * versions were wrong (one said keel scoped threads only, the other said
 * airline had no resolver; each had just been made false by the other's slot).
 * The fallback path above is therefore currently unreachable from the registry
 * and is kept for skins that do not exist yet.
 */
export type IdentifyRunUser = (
  properties: { userRole?: string; userId?: string } | undefined,
) => { id: string; name: string };

export interface AgentRegistration {
  /** Factory for this skin's server-only agent. */
  createAgent: () => BuiltInAgent;
  /** OPTIONAL per-skin identity resolver (see `IdentifyRunUser`). */
  identifyUser?: IdentifyRunUser;
}

export const agentRegistry: Record<string, AgentRegistration> = {
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
  // planner 1:1 — so its Intelligence THREADS are scoped per planner. That is
  // all this resolver buys: logistics ships neither
  // `intelligence/seed-memories.ts` nor `intelligence/forget-memories.ts`, so
  // there is nothing seeded to recall and nothing learned to forget. Identity
  // plumbing only — do NOT read it as a durable-memory demo.
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
};

export const agentIds = Object.keys(agentRegistry);
