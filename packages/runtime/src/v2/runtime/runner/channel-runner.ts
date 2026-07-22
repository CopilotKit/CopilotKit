import type { AbstractAgent } from "@ag-ui/client";
import type {
  Channel,
  ChannelAgentRouteContext,
  ChannelAgentSelection,
  ChannelConcurrencyContext,
  ChannelConcurrencyDecision,
} from "@copilotkit/channels-core";
import type { AgentRunner } from "./agent-runner";
import type { ChannelsControl } from "../core/channel-manager";

/**
 * Runtime-side Channel execution contracts (Task 8).
 *
 * `@internal` — these are EXPORTED so a team can build the production system
 * themselves via a custom `ChannelRunner`, but they are an UNDOCUMENTED,
 * unsupported surface (review assumption A6). The contract shape is DERIVED from
 * the plan's §2 and must be reconciled against the planned artifact before the
 * beta cut (review assumption A9).
 */

/**
 * @internal
 * One declared {@link Channel} compiled into a single Runtime-executable
 * binding. The Runtime creates one per Channel; a custom runner receives the
 * same normalized methods.
 */
export interface RuntimeChannelBinding {
  readonly channel: Channel;
  /**
   * Select the agent for a NEW turn (runs the router once). The returned key is
   * durably pinned by the caller before any customer code or agent runs.
   */
  selectAgent(
    context: ChannelAgentRouteContext,
  ): Promise<ChannelAgentSelection>;
  /**
   * Resolve a pinned selection key to a cloned, canonical-thread-assigned
   * agent. Called on the execution path (and on retry/failover with the pinned
   * key). Unknown/unavailable keys fail loud — never a fallback to `"default"`.
   */
  resolveAgent(input: {
    selectionKey: string;
    threadId: string;
    runId: string;
  }): Promise<AbstractAgent>;
  /** Decide how a new turn interacts with an in-flight one for this Channel. */
  decideConcurrency(
    context: ChannelConcurrencyContext,
  ): Promise<ChannelConcurrencyDecision>;
}

/**
 * @internal
 * Request to start a set of Channel bindings. The runner drives each binding's
 * delivery through the one outer {@link AgentRunner} run per Channel turn.
 */
export interface ChannelRunnerStartRequest {
  readonly bindings: readonly RuntimeChannelBinding[];
  readonly agentRunner: AgentRunner;
}

/**
 * @internal
 * The production runner contract. With Intelligence configured, the Runtime
 * always creates `IntelligenceChannelRunner`; without Intelligence, Channels
 * require an explicit custom `channelRunner` that supplies its own
 * connectivity, persistence, selection pinning, retries, provider effects,
 * failover, and shutdown. EXPORTED + tested but UNDOCUMENTED (A6).
 */
export abstract class ChannelRunner {
  abstract start(request: ChannelRunnerStartRequest): ChannelsControl;
}
