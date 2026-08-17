import { describe, expect, it } from "vitest";

import { DEMO_RUNTIME_OPTIONS } from "./demo-runtime-options";

/**
 * The freeze is the ONLY thing that makes the by-reference return in
 * `mergeRuntimeOptions` safe, and until this file existed nothing asserted it.
 *
 * `mergeRuntimeOptions` copies one level, so a merged `mcpApps` group IS the
 * module-level constant this table exports — `agent-resolution.test.ts`
 * ("ALIASES a base group the override never mentions") pins that aliasing as
 * intended behaviour and cites the deep freeze as the mitigation, in prose. It
 * was prose only: deleting both `deepFreeze(` wrappers left every test in the
 * suite green while `mcp-apps`/`headless-complete` and
 * `open-gen-ui`/`open-gen-ui-advanced` shared one LIVE, MUTABLE object across
 * requests. One in-place edit downstream would then change what a second demo,
 * in a second request, is served.
 *
 * So the assertions below check DEPTH, not just the top level — the whole point
 * of `deepFreeze` over `Object.freeze` — down to an object nested inside an
 * array, and they check that a write actually THROWS rather than silently
 * no-op'ing. A frozen object only throws on assignment in strict mode; every
 * module here is an ES module, so strict mode is on and the throw is real.
 */
describe("DEMO_RUNTIME_OPTIONS is deep-frozen", () => {
  it("freezes the table itself", () => {
    expect(Object.isFrozen(DEMO_RUNTIME_OPTIONS)).toBe(true);
  });

  it("freezes every per-demo entry", () => {
    for (const [demoId, options] of Object.entries(DEMO_RUNTIME_OPTIONS)) {
      expect(Object.isFrozen(options), demoId).toBe(true);
    }
  });

  it("freezes the mcpApps group, its servers array, AND the server inside it", () => {
    // The deepest level that exists in this table: an object inside an array
    // inside a group. `Object.freeze` on the entry alone leaves all three of
    // these writable, which is exactly the hazard.
    const entry = DEMO_RUNTIME_OPTIONS["mcp-apps"] as {
      mcpApps: { servers: { url: string }[] };
    };
    expect(Object.isFrozen(entry.mcpApps)).toBe(true);
    expect(Object.isFrozen(entry.mcpApps.servers)).toBe(true);
    expect(entry.mcpApps.servers.length).toBeGreaterThan(0);
    for (const server of entry.mcpApps.servers) {
      expect(Object.isFrozen(server)).toBe(true);
    }
  });

  it("freezes the openGenerativeUI agents array and pins its contents", () => {
    const entry = DEMO_RUNTIME_OPTIONS["open-gen-ui"] as {
      openGenerativeUI: { agents: string[] };
    };
    expect(Object.isFrozen(entry.openGenerativeUI)).toBe(true);
    expect(Object.isFrozen(entry.openGenerativeUI.agents)).toBe(true);
    expect(entry.openGenerativeUI.agents).toEqual([
      "open-gen-ui",
      "open-gen-ui-advanced",
    ]);
  });

  it("THROWS on a nested write instead of silently dropping it", () => {
    // `Object.isFrozen` alone would pass on a shallow freeze of a leaf that
    // holds no objects. These are the writes a downstream mutation would
    // actually attempt, and each one must be loud at the line that does it.
    const mcp = DEMO_RUNTIME_OPTIONS["mcp-apps"] as {
      mcpApps: { servers: { url: string }[] };
    };
    expect(() => {
      mcp.mcpApps.servers[0].url = "http://evil.test";
    }).toThrow(TypeError);
    expect(() => {
      mcp.mcpApps.servers.push({ url: "http://evil.test" });
    }).toThrow(TypeError);

    const ogui = DEMO_RUNTIME_OPTIONS["open-gen-ui"] as {
      openGenerativeUI: { agents: string[] };
    };
    expect(() => {
      ogui.openGenerativeUI.agents.push("smuggled");
    }).toThrow(TypeError);
    expect(() => {
      (ogui as Record<string, unknown>).openGenerativeUI = {};
    }).toThrow(TypeError);
  });

  it("hands the SAME frozen object to both demos that share a default", () => {
    // Not a coincidence to be tidied away: the sharing is what makes the
    // freeze load-bearing. If these ever stop being identical the freeze can
    // be relaxed, and this test says so out loud.
    expect(DEMO_RUNTIME_OPTIONS["mcp-apps"]).toBe(
      DEMO_RUNTIME_OPTIONS["headless-complete"],
    );
    expect(DEMO_RUNTIME_OPTIONS["open-gen-ui"]).toBe(
      DEMO_RUNTIME_OPTIONS["open-gen-ui-advanced"],
    );
  });
});
