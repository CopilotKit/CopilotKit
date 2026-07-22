import { describe, it, expect } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import type {
  Channel,
  ChannelAgentBinding,
  ChannelAgentRouteContext,
  ChannelConcurrencyPolicy,
} from "@copilotkit/channels";
import { compileChannelBinding } from "../compile-channel-binding";

/** Minimal AbstractAgent double with a working clone() and an id tag. */
class TagAgent extends AbstractAgent {
  constructor(readonly tag: string) {
    super();
  }
  clone(): AbstractAgent {
    return new TagAgent(this.tag);
  }
  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

/**
 * Build a structural Channel exposing only the `ɵruntime` surface the compiler
 * reads. The real (pure-ESM) `createChannel` cannot be imported from this
 * CJS package's tests, so — as the channel-manager tests do — we inject a
 * structural double.
 */
function fakeChannel(opts: {
  name?: string;
  agentBinding?: ChannelAgentBinding;
  concurrency?: ChannelConcurrencyPolicy;
}): Channel {
  return {
    name: opts.name ?? "support",
    adapters: [],
    commandNames: [],
    ɵruntime: {
      ...(opts.agentBinding !== undefined
        ? { agentBinding: opts.agentBinding }
        : {}),
      ...(opts.concurrency !== undefined
        ? { concurrency: opts.concurrency }
        : {}),
    },
  } as unknown as Channel;
}

const routeContext = (
  overrides: Partial<ChannelAgentRouteContext> = {},
): ChannelAgentRouteContext => ({
  channelName: "support",
  platform: "slack",
  turnId: "turn-1",
  conversation: { key: "C1:U1", kind: "direct_message" },
  event: { kind: "message", text: "hi" },
  signal: new AbortController().signal,
  ...overrides,
});

const concurrencyContext = () => ({
  channelName: "support",
  conversationKey: "C1:U1",
  turnId: "turn-1",
});

describe("compileChannelBinding — selectAgent", () => {
  it("pins an inline agent binding to the 'channel:<name>:inline' key", async () => {
    const inline = new TagAgent("inline-agent");
    const binding = compileChannelBinding(
      fakeChannel({ agentBinding: inline }),
      { resolveNamedAgent: () => undefined },
    );

    const selection = await binding.selectAgent(routeContext());

    expect(selection.key).toBe("channel:support:inline");
  });

  it("pins a named binding to the 'runtime:<name>' key", async () => {
    const binding = compileChannelBinding(
      fakeChannel({ agentBinding: "billing" }),
      {
        resolveNamedAgent: (n) =>
          n === "billing" ? new TagAgent(n) : undefined,
      },
    );

    const selection = await binding.selectAgent(routeContext());

    expect(selection.key).toBe("runtime:billing");
  });

  it("pins an omitted binding to the default agent key", async () => {
    const binding = compileChannelBinding(fakeChannel({}), {
      resolveNamedAgent: (n) => (n === "default" ? new TagAgent(n) : undefined),
    });

    const selection = await binding.selectAgent(routeContext());

    expect(selection.key).toBe("runtime:default");
  });

  it("runs a router once and pins its returned name", async () => {
    let calls = 0;
    const binding = compileChannelBinding(
      fakeChannel({
        agentBinding: (ctx: ChannelAgentRouteContext) => {
          calls++;
          return ctx.user?.id === "travis" ? "travis" : "default";
        },
      }),
      { resolveNamedAgent: (n) => new TagAgent(n) },
    );

    const selection = await binding.selectAgent(
      routeContext({ user: { id: "travis" } }),
    );

    expect(selection.key).toBe("runtime:travis");
    expect(calls).toBe(1);
  });

  it("fails loud when a router returns an unknown agent name (no fallback)", async () => {
    const binding = compileChannelBinding(
      fakeChannel({ name: "triage", agentBinding: () => "ghost" }),
      {
        resolveNamedAgent: (n) =>
          n === "default" ? new TagAgent(n) : undefined,
      },
    );

    await expect(binding.selectAgent(routeContext())).rejects.toThrow(
      'Channel "triage" agent router returned unknown Runtime agent "ghost".',
    );
  });

  it("fails loud when a router returns an agent object instead of a name", async () => {
    const binding = compileChannelBinding(
      fakeChannel({
        name: "triage",
        // A router must return a NAME (string); returning an agent object is a
        // programming error the runtime rejects loudly.
        agentBinding: (() => new TagAgent("nope")) as never,
      }),
      { resolveNamedAgent: () => new TagAgent("default") },
    );

    await expect(binding.selectAgent(routeContext())).rejects.toThrow(
      'Channel "triage" agent router must return a registered agent name, not an agent object.',
    );
  });
});

describe("compileChannelBinding — resolveAgent", () => {
  it("clones the inline agent and assigns the canonical thread id", async () => {
    const inline = new TagAgent("inline-agent");
    const binding = compileChannelBinding(
      fakeChannel({ agentBinding: inline }),
      { resolveNamedAgent: () => undefined },
    );

    const resolved = await binding.resolveAgent({
      selectionKey: "channel:support:inline",
      threadId: "thr_canonical",
      runId: "run_1",
    });

    expect(resolved).toBeInstanceOf(TagAgent);
    expect(resolved).not.toBe(inline); // a distinct clone, never the shared instance
    expect(resolved.threadId).toBe("thr_canonical");
  });

  it("resolves + clones a named agent and stamps id + thread", async () => {
    const registry = new Map([["billing", new TagAgent("billing")]]);
    const binding = compileChannelBinding(
      fakeChannel({ agentBinding: "billing" }),
      { resolveNamedAgent: (n) => registry.get(n) },
    );

    const resolved = await binding.resolveAgent({
      selectionKey: "runtime:billing",
      threadId: "thr_canonical",
      runId: "run_1",
    });

    expect(resolved).not.toBe(registry.get("billing"));
    expect(resolved.agentId).toBe("billing");
    expect(resolved.threadId).toBe("thr_canonical");
  });

  it("fails loud on an unknown named key — never falls back to default", async () => {
    const binding = compileChannelBinding(
      fakeChannel({ agentBinding: "billing" }),
      { resolveNamedAgent: () => undefined },
    );

    await expect(
      binding.resolveAgent({
        selectionKey: "runtime:billing",
        threadId: "thr",
        runId: "run",
      }),
    ).rejects.toThrow(/billing/);
  });

  it("fails loud on an inline key when the channel has no inline agent", async () => {
    const binding = compileChannelBinding(
      fakeChannel({ agentBinding: "billing" }),
      { resolveNamedAgent: (n) => new TagAgent(n) },
    );

    await expect(
      binding.resolveAgent({
        selectionKey: "channel:support:inline",
        threadId: "thr",
        runId: "run",
      }),
    ).rejects.toThrow(/inline/);
  });
});

describe("compileChannelBinding — decideConcurrency", () => {
  it("defaults to 'replace' when no policy is declared", async () => {
    const binding = compileChannelBinding(fakeChannel({}), {
      resolveNamedAgent: (n) => new TagAgent(n),
    });

    await expect(binding.decideConcurrency(concurrencyContext())).resolves.toBe(
      "replace",
    );
  });

  it("honors the channel's declared concurrency decision", async () => {
    const binding = compileChannelBinding(
      fakeChannel({ concurrency: { onConcurrent: "queue" } }),
      { resolveNamedAgent: (n) => new TagAgent(n) },
    );

    await expect(binding.decideConcurrency(concurrencyContext())).resolves.toBe(
      "queue",
    );
  });
});

describe("compileChannelBinding — channel reference", () => {
  it("exposes the compiled channel on the binding", () => {
    const channel = fakeChannel({ agentBinding: "billing" });
    const binding = compileChannelBinding(channel, {
      resolveNamedAgent: (n) => new TagAgent(n),
    });

    expect(binding.channel).toBe(channel);
  });
});
