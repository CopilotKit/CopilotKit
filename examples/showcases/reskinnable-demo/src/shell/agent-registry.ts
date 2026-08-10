import type { BuiltInAgent } from "@copilotkit/runtime/v2";
import { bankingAgent } from "@/skins/banking/agent";
import { airlineAgent } from "@/skins/airline/agent";
import { keelAgent } from "@/skins/keel/agent";
import { bankingIdentifyUser } from "@/skins/banking/intelligence/user-id";
import { keelIdentifyUser } from "@/skins/keel/intelligence/user-id";
import { logisticsAgent } from "@/skins/logistics/agent";
import { logisticsIdentifyUser } from "@/skins/logistics/intelligence/user-id";
import { peopleAgent } from "@/skins/people/agent";
import { peopleIdentifyUser } from "@/skins/people/intelligence/user-id";

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
 * skin supplies this only if it has per-user memory; skins without it (e.g.
 * airline) let the runtime fall back to a generic identity.
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
  // Airline has no auth and no memory, so it contributes no identity resolver.
  airline: { createAgent: airlineAgent },
  // Logistics scopes Intelligence per planner (authority + durable memory), so
  // it contributes its own resolver.
  logistics: {
    createAgent: logisticsAgent,
    identifyUser: logisticsIdentifyUser,
  },
  // Keel scopes Intelligence per persona (privacy/clinical staff), so it
  // contributes its own resolver alongside the agent factory.
  keel: { createAgent: keelAgent, identifyUser: keelIdentifyUser },
  // Rowan scopes Intelligence per operator: the seeded beat-4 preference and
  // beat-5 procedure belong to Maya, and switching to Clara must land in a
  // different memory bucket so a colleague visibly has NOT taught it anything.
  people: { createAgent: peopleAgent, identifyUser: peopleIdentifyUser },
};

export const agentIds = Object.keys(agentRegistry);
