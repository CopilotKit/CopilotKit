import type { AbstractAgent } from "@ag-ui/client";
import type { Channel } from "@copilotkit/channels";
import { compileChannelBinding } from "./compile-channel-binding";
import type { RuntimeChannelBinding } from "./channel-runner";

/**
 * Compile a Runtime's declared Channels into internal
 * {@link RuntimeChannelBinding}s, validating the agent wiring at STARTUP (plan
 * §2 / Task 8). This is the bridge from `CopilotRuntime`'s public config
 * (`channels` + `agents`) to the bindings the {@link ChannelRunner} drives.
 *
 * Startup validation (fails loud, per the §2 error copy):
 * - Omitted agent requires a Runtime agent named `"default"`.
 * - A fixed named agent must be registered.
 * - A router's output is NOT validated here — it runs per turn (validated in
 *   the binding's `selectAgent`).
 * - Named/routed/default Channels are incompatible with a request-scoped
 *   `AgentsFactory` (Channel delivery has no HTTP `Request` to resolve it).
 *   Inline-only Channels are fine under a factory.
 *
 * Inline agents need no Runtime registry entry — the binding clones the declared
 * instance directly under its `channel:<name>:inline` key. `@internal`.
 */

const DEFAULT_AGENT_NAME = "default";

export interface CompileRuntimeChannelBindingsInput {
  /** The Runtime's declared Channels. */
  readonly channels: readonly Channel[];
  /**
   * The Runtime's statically-resolved agents by name, or `undefined` when
   * `agents` is a request-scoped {@link AgentsFactory} (see
   * `requestScopedAgents`).
   */
  readonly agents: Record<string, AbstractAgent> | undefined;
  /**
   * True when `runtime.agents` is a request-scoped factory that cannot be
   * resolved without an HTTP request — which Channel delivery does not have.
   */
  readonly requestScopedAgents: boolean;
}

/** Classify a Channel's declared binding mode from its `ɵruntime` surface. */
function bindingModeOf(
  channel: Channel,
): "inline" | "named" | "router" | "default" {
  const binding = channel.ɵruntime?.agentBinding;
  if (binding === undefined) return "default";
  if (typeof binding === "string") return "named";
  if (typeof binding === "function") return "router";
  return "inline";
}

export function compileRuntimeChannelBindings(
  input: CompileRuntimeChannelBindingsInput,
): RuntimeChannelBinding[] {
  const { channels, agents, requestScopedAgents } = input;
  const resolveNamedAgent = (name: string): AbstractAgent | undefined =>
    agents?.[name];

  return channels.map((channel) => {
    const name = channel.name ?? "(unnamed)";
    const mode = bindingModeOf(channel);

    // A request-scoped AgentsFactory can only ever serve an inline Channel —
    // there is no HTTP request to resolve named/routed/default agents against.
    if (requestScopedAgents && mode !== "inline") {
      throw new Error(
        `Channel "${name}" cannot use a request-scoped AgentsFactory.`,
      );
    }

    if (mode === "default" && !resolveNamedAgent(DEFAULT_AGENT_NAME)) {
      throw new Error(
        `Channel "${name}" has no agent. Register runtime.agents.default or ` +
          `set createChannel({ agent }).`,
      );
    }

    if (mode === "named") {
      // Safe: mode "named" means the binding is a string.
      const agentName = channel.ɵruntime!.agentBinding as string;
      if (!resolveNamedAgent(agentName)) {
        throw new Error(
          `Channel "${name}" selects unknown Runtime agent "${agentName}".`,
        );
      }
    }

    // Router output is validated per turn in selectAgent, not at startup.
    return compileChannelBinding(channel, { resolveNamedAgent });
  });
}
