import { describe, it, expect } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import type { Channel, ChannelAgentBinding } from "@copilotkit/channels";
import { compileRuntimeChannelBindings } from "../compile-runtime-channel-bindings";

class NoopAgent extends AbstractAgent {
  clone(): AbstractAgent {
    return new NoopAgent();
  }
  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

function channel(name: string, agentBinding?: ChannelAgentBinding): Channel {
  return {
    name,
    adapters: [],
    commandNames: [],
    ɵruntime: agentBinding !== undefined ? { agentBinding } : {},
  } as unknown as Channel;
}

const agents = (names: string[]): Record<string, AbstractAgent> =>
  Object.fromEntries(names.map((n) => [n, new NoopAgent()]));

describe("compileRuntimeChannelBindings — startup validation", () => {
  it("compiles one binding per channel, preserving order + channel ref", () => {
    const chans = [
      channel("support", "default"),
      channel("billing", "billing"),
    ];
    const bindings = compileRuntimeChannelBindings({
      channels: chans,
      agents: agents(["default", "billing"]),
      requestScopedAgents: false,
    });
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.channel).toBe(chans[0]);
    expect(bindings[1]!.channel).toBe(chans[1]);
  });

  it("throws when an omitted-agent channel has no runtime 'default'", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("support")],
        agents: agents(["billing"]),
        requestScopedAgents: false,
      }),
    ).toThrow(
      'Channel "support" has no agent. Register runtime.agents.default or set createChannel({ agent }).',
    );
  });

  it("accepts an omitted-agent channel when 'default' exists", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("support")],
        agents: agents(["default"]),
        requestScopedAgents: false,
      }),
    ).not.toThrow();
  });

  it("throws when a named-agent channel selects an unknown agent", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("support", "billing")],
        agents: agents(["default"]),
        requestScopedAgents: false,
      }),
    ).toThrow('Channel "support" selects unknown Runtime agent "billing".');
  });

  it("accepts an inline-agent channel with no runtime agents at all", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("scratch", new NoopAgent())],
        agents: {},
        requestScopedAgents: false,
      }),
    ).not.toThrow();
  });

  it("does not validate a router's output at startup (runs per turn)", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("triage", () => "whoever")],
        agents: agents(["default"]),
        requestScopedAgents: false,
      }),
    ).not.toThrow();
  });
});

describe("compileRuntimeChannelBindings — request-scoped AgentsFactory", () => {
  it("rejects a named-agent channel when agents is a request-scoped factory", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("support", "billing")],
        agents: undefined,
        requestScopedAgents: true,
      }),
    ).toThrow('Channel "support" cannot use a request-scoped AgentsFactory.');
  });

  it("rejects an omitted-agent channel under a request-scoped factory", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("support")],
        agents: undefined,
        requestScopedAgents: true,
      }),
    ).toThrow('Channel "support" cannot use a request-scoped AgentsFactory.');
  });

  it("allows an inline-agent channel under a request-scoped factory", () => {
    expect(() =>
      compileRuntimeChannelBindings({
        channels: [channel("scratch", new NoopAgent())],
        agents: undefined,
        requestScopedAgents: true,
      }),
    ).not.toThrow();
  });
});

describe("compileRuntimeChannelBindings — resolution wiring", () => {
  it("wires named resolution so selectAgent produces the runtime:<name> key", async () => {
    const [binding] = compileRuntimeChannelBindings({
      channels: [channel("support", "billing")],
      agents: agents(["billing"]),
      requestScopedAgents: false,
    });
    const selection = await binding!.selectAgent({
      channelName: "support",
      platform: "slack",
      turnId: "t1",
      conversation: { key: "C1", kind: "direct_message" },
      event: { kind: "message", text: "hi" },
      signal: new AbortController().signal,
    });
    expect(selection.key).toBe("runtime:billing");
  });
});
