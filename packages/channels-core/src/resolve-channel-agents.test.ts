import { describe, expect, it } from "vitest";
import { FakeAgent } from "./testing/fake-agent.js";
import {
  canonicalAgentId,
  checkpointThreadId,
  resolveChannelAgents,
} from "./resolve-channel-agents.js";
import {
  ChannelDuplicateDefaultError,
  ChannelInvalidAgentIdError,
} from "./channel-agent-errors.js";

describe("resolveChannelAgents", () => {
  it("uses singular agent as default when agents.default is missing", () => {
    const support = new FakeAgent();
    const billing = new FakeAgent();
    const resolved = resolveChannelAgents({
      agent: support,
      agents: { billing },
    });
    expect(resolved.defaultId).toBe("default");
    expect([...resolved.sources.keys()].sort()).toEqual(["billing", "default"]);
    expect(resolved.sources.get("default")).toBe(support);
    expect(resolved.sources.get("billing")).toBe(billing);
  });

  it("uses agents.default when singular agent is omitted", () => {
    const def = new FakeAgent();
    const resolved = resolveChannelAgents({
      agents: { default: def, billing: new FakeAgent() },
    });
    expect(resolved.defaultId).toBe("default");
    expect(resolved.sources.has("default")).toBe(true);
    expect(resolved.sources.get("default")).toBe(def);
  });

  it("has no default when only extras are passed", () => {
    const resolved = resolveChannelAgents({
      agents: { billing: new FakeAgent() },
    });
    expect(resolved.defaultId).toBeUndefined();
    expect([...resolved.sources.keys()]).toEqual(["billing"]);
  });

  it("throws when both agent and agents.default are set", () => {
    expect(() =>
      resolveChannelAgents({
        agent: new FakeAgent(),
        agents: { default: new FakeAgent() },
      }),
    ).toThrow(ChannelDuplicateDefaultError);
  });

  it.each(["", " billing", "billing ", "foo:bar", "foo::bar"])(
    "rejects invalid id %j",
    (id) => {
      expect(() =>
        resolveChannelAgents({
          agents: { [id]: new FakeAgent() },
        }),
      ).toThrow(ChannelInvalidAgentIdError);
    },
  );

  it("treats Billing and billing as different ids", () => {
    const resolved = resolveChannelAgents({
      agents: { billing: new FakeAgent(), Billing: new FakeAgent() },
    });
    expect(resolved.sources.has("billing")).toBe(true);
    expect(resolved.sources.has("Billing")).toBe(true);
  });

  it("returns an empty map when no agent and no agents are passed", () => {
    const resolved = resolveChannelAgents({});
    expect(resolved.defaultId).toBeUndefined();
    expect(resolved.sources.size).toBe(0);
  });

  it("stores factory sources without calling them", () => {
    const instance = new FakeAgent();
    const factory = (threadId: string) => {
      void threadId;
      throw new Error("factory must not run during resolve");
    };
    const resolved = resolveChannelAgents({
      agent: factory,
      agents: { billing: instance },
    });
    expect(resolved.defaultId).toBe("default");
    expect(resolved.sources.get("default")).toBe(factory);
    expect(resolved.sources.get("billing")).toBe(instance);
  });
});

describe("checkpointThreadId / canonicalAgentId", () => {
  it("keeps default checkpoint and wire ids unsuffixed", () => {
    expect(checkpointThreadId("thr_abc", "default")).toBe("thr_abc");
    expect(canonicalAgentId("triage", "default")).toBe("triage");
  });

  it("suffixes extra agents", () => {
    expect(checkpointThreadId("thr_abc", "billing")).toBe("thr_abc::billing");
    expect(canonicalAgentId("triage", "billing")).toBe("triage:billing");
  });

  it("returns extra agentId when channelName is missing", () => {
    expect(canonicalAgentId(undefined, "billing")).toBe("billing");
    expect(canonicalAgentId(undefined, "default")).toBeUndefined();
  });
});
