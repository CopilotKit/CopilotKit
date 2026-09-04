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

  it("exports `agentIds` as exactly the registered server keys", () => {
    // `agentIds` is what the API route iterates to build its agent map; a stale
    // export would 404 a skin that IS registered.
    expect(agentIds).toEqual(Object.keys(agentRegistry));
  });

  it("gives every registration a callable agent factory", () => {
    for (const [id, registration] of Object.entries(agentRegistry)) {
      expect(
        typeof registration.createAgent,
        `${id} has no createAgent factory`,
      ).toBe("function");
    }
  });
});
