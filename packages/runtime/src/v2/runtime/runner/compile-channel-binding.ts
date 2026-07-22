import type { AbstractAgent } from "@ag-ui/client";
import type {
  Channel,
  ChannelAgentRouteContext,
  ChannelAgentSelection,
  ChannelConcurrencyContext,
  ChannelConcurrencyDecision,
} from "@copilotkit/channels";
import type { RuntimeChannelBinding } from "./channel-runner";

/**
 * Compile a declared {@link Channel} into a Runtime-executable
 * {@link RuntimeChannelBinding} (Task 2 + Task 8).
 *
 * A Channel declares WHICH agent it uses via its four-mode
 * `ChannelAgentBinding` (inline / named / router / default); it is the
 * Runtime — not the Channel — that resolves named/routed/default agents against
 * its own agent registry and clones the selected agent per turn. This compiler
 * is that resolution: it reads the Channel's `ɵruntime` binding surface and
 * produces the normalized `selectAgent`/`resolveAgent`/`decideConcurrency`
 * methods the {@link ChannelRunner} drives.
 *
 * `@internal` — consumed by the Runtime and (via the exported-but-undocumented
 * ChannelRunner contract) a custom runner; not a public surface (A6).
 */

/** Opaque selection key for the single inline agent a Channel may declare. */
const INLINE_KEY = "inline";
/** Namespace prefix for a named Runtime agent selection key. */
const NAMED_PREFIX = "named:";
/** The Runtime agent an omitted binding targets. */
const DEFAULT_AGENT_NAME = "default";

/** What the compiler needs from the Runtime to resolve named agents. */
export interface ChannelBindingCompilerDeps {
  /**
   * Resolve a named Runtime agent to its registered instance, or `undefined`
   * if no agent is registered under that name. The compiler NEVER falls back to
   * a default on `undefined` — an unknown name fails loud (see the
   * `ChannelAgentRouter` contract).
   */
  resolveNamedAgent(name: string): AbstractAgent | undefined;
}

/**
 * Build a {@link RuntimeChannelBinding} for `channel`. Pure aside from calling
 * `deps.resolveNamedAgent` and, for a router binding, the Channel's router.
 */
export function compileChannelBinding(
  channel: Channel,
  deps: ChannelBindingCompilerDeps,
): RuntimeChannelBinding {
  const binding = channel.ɵruntime?.agentBinding;

  // The inline mode is the only one channels-core can carry as a value — an
  // AbstractAgent instance (an object that is neither a string nor a function).
  const inlineAgent =
    binding != null &&
    typeof binding !== "string" &&
    typeof binding !== "function"
      ? (binding as AbstractAgent)
      : undefined;

  /** Resolve a name to its registered agent or fail loud — never a fallback. */
  const requireNamedAgent = (name: string): AbstractAgent => {
    const agent = deps.resolveNamedAgent(name);
    if (!agent) {
      throw new Error(
        `Channel "${channel.name ?? "(unnamed)"}" selected the Runtime agent ` +
          `"${name}", but no agent is registered under that name. Register it ` +
          `on the Runtime, or fix the Channel's agent binding — there is no ` +
          `fallback to the default agent.`,
      );
    }
    return agent;
  };

  return {
    channel,

    async selectAgent(
      context: ChannelAgentRouteContext,
    ): Promise<ChannelAgentSelection> {
      if (inlineAgent) {
        return { key: INLINE_KEY };
      }
      let name: string;
      if (typeof binding === "string") {
        name = binding;
      } else if (typeof binding === "function") {
        name = await binding(context);
      } else {
        name = DEFAULT_AGENT_NAME;
      }
      // Validate at selection time so a bad routing decision fails BEFORE the
      // key is durably pinned (resolveAgent revalidates on the execution path).
      requireNamedAgent(name);
      return { key: `${NAMED_PREFIX}${name}` };
    },

    async resolveAgent(input: {
      selectionKey: string;
      threadId: string;
      runId: string;
    }): Promise<AbstractAgent> {
      let source: AbstractAgent;
      let agentId: string | undefined;
      if (input.selectionKey === INLINE_KEY) {
        if (!inlineAgent) {
          throw new Error(
            `Channel "${channel.name ?? "(unnamed)"}" was asked to resolve the ` +
              `inline agent, but it declares no inline agent binding.`,
          );
        }
        source = inlineAgent;
      } else if (input.selectionKey.startsWith(NAMED_PREFIX)) {
        const name = input.selectionKey.slice(NAMED_PREFIX.length);
        source = requireNamedAgent(name);
        agentId = name;
      } else {
        throw new Error(
          `Unrecognized Channel agent selection key "${input.selectionKey}".`,
        );
      }
      // Clone per execution and assign the canonical thread id so concurrent
      // turns never share agent state (Task 8).
      const cloned = source.clone() as AbstractAgent;
      cloned.threadId = input.threadId;
      if (agentId !== undefined) {
        cloned.agentId = agentId;
      }
      return cloned;
    },

    async decideConcurrency(
      _context: ChannelConcurrencyContext,
    ): Promise<ChannelConcurrencyDecision> {
      return channel.ɵruntime?.concurrency?.onConcurrent ?? "replace";
    },
  };
}
