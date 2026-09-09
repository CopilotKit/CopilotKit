import { describe, expect, it } from "vitest";
import { agentIds, agentRegistry } from "./agent-registry";
import { SkinRegistry } from "./registry";

/**
 * THE TWO-REGISTRY INVARIANT.
 *
 * A skin is registered TWICE and the two halves cannot import each other:
 * `registry.ts` holds the CLIENT skin (layout, pages, tools — client
 * components), and `agent-registry.ts` holds the SERVER registration (the agent
 * factory, which pulls `@copilotkit/runtime` and must never reach the browser).
 * The only thing joining them is the shared id, restated by hand in both files,
 * and both `agent-registry.ts`'s own doc comment and `registry.ts`'s say so
 * ("registered separately in agent-registry.ts under the SAME id (=== agentId)").
 *
 * A hand-restated key with no check is a key that eventually differs. Miss the
 * server half and the skin renders perfectly — nav, pages, chat chrome, the lot
 * — and then 404s the moment anyone sends a message, because the shared API
 * route looks the agent up by id and finds nothing. Miss the client half and a
 * registered agent is unreachable. Neither shows up in `tsc` (both maps are
 * `Record<string, …>`), in lint, or in any suite that tests one side alone:
 * `skins-config.test.ts` next door pins `skinIds`, `LINTED_SKIN_IDS` and
 * `skinIdentities` against the CLIENT registry only, so the server half is the
 * one copy nothing was watching.
 *
 * Every expectation below is DERIVED from the two exported structures. Nothing
 * here hardcodes a roster or a count — that would make this file another copy
 * to keep in step, which is the defect it exists to catch.
 */
describe("SkinRegistry ↔ agentRegistry", () => {
  it("registers a server agent for every client skin, and a client skin for every server agent", () => {
    // Sorted so the failure diff names the MISSING ID rather than reporting a
    // reordering, and asserted in one direction with `toEqual` so a miss on
    // either side fails here (a one-way `toContain` sweep would let an orphan
    // server registration through).
    expect(Object.keys(agentRegistry).sort()).toEqual(
      Object.keys(SkinRegistry).sort(),
    );
  });

  it("files every client skin under its own `id`", () => {
    // `SkinRegistry` is built as `{ [skin.id]: skin }`, but nothing stops a
    // future literal key from drifting off the skin's own id — and the id is
    // what the server half is matched against above.
    for (const [key, skin] of Object.entries(SkinRegistry)) {
      expect(skin.id, `SkinRegistry key "${key}" holds skin "${skin.id}"`).toBe(
        key,
      );
    }
  });

  it("exports `agentIds` as exactly the skin roster", () => {
    // `agentIds` is what the API route iterates to build its agent map, so a
    // stale export 404s a skin that IS registered.
    //
    // Checked against the CLIENT registry rather than against
    // `Object.keys(agentRegistry)`: `agentIds` is currently DEFINED as
    // `Object.keys(agentRegistry)`, so comparing it back to that expression
    // restates the definition and passes for every implementation of it. Going
    // through `SkinRegistry` makes this a claim about the roster instead, which
    // survives `agentIds` being rewritten as a hand-maintained literal — the
    // one shape that can actually go stale.
    expect([...agentIds].sort()).toEqual(Object.keys(SkinRegistry).sort());
  });

  /**
   * THE UNTRUSTED-KEY INVARIANT.
   *
   * `agentRegistry` is indexed with a URL-derived id: the shared API route does
   * `agentRegistry[agentId]?.identifyUser` on an `agentId` parsed straight out
   * of `request.url` (`src/app/api/copilotkit/[[...slug]]/route.ts`). A plain
   * object walks the PROTOTYPE CHAIN on an index, so `constructor`,
   * `toString`, `valueOf`, `hasOwnProperty`, `__proto__` … each hand back a
   * truthy INHERITED member instead of `undefined` — the exact hazard
   * `getSkin` was fixed for next door (`src/shell/registry.ts`), on the same
   * ids, one registry over. `Record<string, AgentRegistration>` cannot catch
   * it: the annotation describes the map's own entries, not what indexing it
   * returns.
   *
   * Today the route survives on `?.` — the inherited members carry no
   * `identifyUser`, so the optional chain yields `undefined` and the generic
   * identity answers. That is luck, not a guarantee: any second reader that
   * drops the `?.`, or reaches for `.createAgent()` the way the agent-map
   * builder above it does, gets a 500 out of a URL anyone can type.
   *
   * Pinned as BEHAVIOUR at the index — this is what every call site does —
   * rather than by asserting which own-key primitive implements it.
   */
  it("does not resolve Object.prototype members as registrations", () => {
    const inherited = [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "__proto__",
      "__defineGetter__",
    ];
    for (const key of inherited) {
      expect(agentRegistry[key], `agentRegistry["${key}"]`).toBeUndefined();
    }
  });

  it("still resolves, and still enumerates, every registered id", () => {
    // The own-key guarantee above must not have been bought by breaking the
    // two things the route does with this map: index it by a known id, and
    // enumerate it (via `agentIds`) to build the runtime's agent map.
    for (const id of agentIds) {
      expect(agentRegistry[id], `agentRegistry["${id}"]`).toBeDefined();
    }
    expect(Object.keys(agentRegistry).sort()).toEqual([...agentIds].sort());
  });

  it("gives every registration a callable agent factory", () => {
    for (const [id, registration] of Object.entries(agentRegistry)) {
      expect(
        typeof registration.createAgent,
        `${id} has no createAgent factory`,
      ).toBe("function");
    }
  });

  it("gives every registration an `identifyUser` resolver", () => {
    // `identifyUser` is typed OPTIONAL because the runtime has a generic
    // fallback for skins that scope nothing — but every skin here supplies one
    // AND uses it for durable memory (that is what `agent-registry.ts`'s own
    // `IdentifyRunUser` doc says, and what `intelligence/seed-memories.ts` next
    // to each resolver relies on). Drop one and the skin keeps working in every
    // visible way while its memories silently move into the shared generic
    // bucket: seeded beats stop being recalled, and whatever the demo teaches
    // it lands somewhere `dev/reset` does not sweep. Nothing else fails —
    // `tsc` is happy, because the field is optional by design.
    //
    // So this is the check that keeps the optional-by-type/required-in-practice
    // gap honest. A ninth skin that genuinely scopes nothing should relax this
    // deliberately, not discover the omission on stage.
    for (const [id, registration] of Object.entries(agentRegistry)) {
      expect(
        typeof registration.identifyUser,
        `${id} has no identifyUser resolver`,
      ).toBe("function");
    }
  });
});
