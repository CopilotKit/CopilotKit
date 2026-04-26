import { describe, it, expect, beforeEach } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
  type D5Script,
} from "./d5-registry.js";

// Registry tests cover the three behaviours Wave 2b script authors rely
// on: (1) multi-feature registration writes one map entry per featureType,
// (2) double-registration of the same featureType throws so script-file
// collisions surface at boot, (3) lookup miss returns undefined so the
// driver can map that to a skipped row.

function makeScript(overrides: Partial<D5Script> = {}): D5Script {
  return {
    featureTypes: ["agentic-chat"],
    fixtureFile: "agentic-chat.json",
    buildTurns: (_ctx: D5BuildContext) => [{ input: "hello" }],
    ...overrides,
  };
}

describe("D5 registry", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("registers a single-feature script and exposes it via getD5Script", () => {
    const script = makeScript({
      featureTypes: ["agentic-chat"],
      fixtureFile: "agentic-chat.json",
    });
    registerD5Script(script);

    expect(getD5Script("agentic-chat")).toBe(script);
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("registers a multi-feature script under every featureType it claims", () => {
    // shared-state-read and shared-state-write share one fixture and one
    // conversation; the registration loop must write one entry per type.
    const script = makeScript({
      featureTypes: ["shared-state-read", "shared-state-write"],
      fixtureFile: "shared-state.json",
    });
    registerD5Script(script);

    expect(getD5Script("shared-state-read")).toBe(script);
    expect(getD5Script("shared-state-write")).toBe(script);
    expect(D5_REGISTRY.size).toBe(2);
  });

  it("throws on double-registration of the same featureType", () => {
    registerD5Script(
      makeScript({
        featureTypes: ["tool-rendering"],
        fixtureFile: "tool-rendering.json",
      }),
    );

    expect(() =>
      registerD5Script(
        makeScript({
          featureTypes: ["tool-rendering"],
          fixtureFile: "tool-rendering-alt.json",
        }),
      ),
    ).toThrow(/already registered/);
  });

  it("throws on double-registration even when the second script claims more featureTypes", () => {
    // First script claims read; second tries to claim both read+write.
    // The conflict on `shared-state-read` should still throw — partial
    // success would leave the map in an inconsistent state.
    registerD5Script(
      makeScript({
        featureTypes: ["shared-state-read"],
        fixtureFile: "shared-state-a.json",
      }),
    );

    expect(() =>
      registerD5Script(
        makeScript({
          featureTypes: ["shared-state-read", "shared-state-write"],
          fixtureFile: "shared-state-b.json",
        }),
      ),
    ).toThrow(/shared-state-read.*already registered/);
  });

  it("throws when featureTypes is empty", () => {
    expect(() =>
      registerD5Script(
        makeScript({
          featureTypes: [],
          fixtureFile: "empty.json",
        }),
      ),
    ).toThrow(/at least one entry/);
  });

  it("returns undefined for an unregistered featureType", () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
      }),
    );

    expect(getD5Script("mcp-apps" satisfies D5FeatureType)).toBeUndefined();
  });

  it("preserves preNavigateRoute when registered", () => {
    // mcp-apps is the canonical case where preNavigateRoute matters: the
    // showcase exposes the feature under /demos/subagents rather than
    // /demos/mcp-apps. The registry must round-trip the override
    // verbatim so the driver picks it up at run time.
    const route = (_ft: D5FeatureType): string => "/demos/subagents";
    const script = makeScript({
      featureTypes: ["mcp-apps", "subagents"],
      fixtureFile: "mcp-subagents.json",
      preNavigateRoute: route,
    });
    registerD5Script(script);

    const fetched = getD5Script("mcp-apps");
    expect(fetched?.preNavigateRoute).toBe(route);
  });
});
