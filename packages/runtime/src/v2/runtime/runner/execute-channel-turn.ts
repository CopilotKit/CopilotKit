import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import type { ChannelAgentRouteContext } from "@copilotkit/channels";
import type { AgentRunner, AgentTurnController } from "./agent-runner";
import type { RuntimeChannelBinding } from "./channel-runner";

/**
 * Per-turn execution core of a {@link ChannelRunner} (Task 1 + Task 8).
 *
 * This is the contract-fixed heart the production {@link IntelligenceChannelRunner}
 * drives once per inbound Channel delivery: it selects the agent for a NEW turn,
 * DURABLY PINS the selection before anything runs, then drives the pinned agent
 * through one fenced outer run ({@link AgentRunner.execute}). It owns NO
 * connectivity, persistence, or provider rendering — the caller supplies the
 * pin store and the turn body. `@internal`.
 */

/**
 * Durable store for a turn's pinned agent selection key. The key is written
 * BEFORE any customer code or agent runs, and re-read on retry/failover so a
 * redelivered turn resolves the SAME agent (never re-routes). The in-memory
 * default is process-local; the production runner supplies an
 * Intelligence-backed implementation.
 */
export interface ChannelSelectionPinStore {
  /** The pinned selection key for `turnKey`, or `undefined` if none is pinned. */
  get(turnKey: string): Promise<string | undefined>;
  /** Durably pin `selectionKey` for `turnKey`. Called before the agent runs. */
  set(turnKey: string, selectionKey: string): Promise<void>;
}

/** Process-local {@link ChannelSelectionPinStore} for tests and headless runs. */
export class InMemorySelectionPinStore implements ChannelSelectionPinStore {
  private readonly pins = new Map<string, string>();
  get(turnKey: string): Promise<string | undefined> {
    return Promise.resolve(this.pins.get(turnKey));
  }
  set(turnKey: string, selectionKey: string): Promise<void> {
    this.pins.set(turnKey, selectionKey);
    return Promise.resolve();
  }
}

/** One Channel turn to execute through a fenced outer run. */
export interface ChannelTurnRequest {
  /** The compiled Channel binding this turn belongs to. */
  binding: RuntimeChannelBinding;
  /**
   * Stable key identifying this turn for durable pinning (e.g.
   * `${channelName}:${turnId}`). A redelivery MUST reuse the same `turnKey` so
   * the pinned selection is honored.
   */
  turnKey: string;
  /** Canonical thread id assigned to the run. */
  threadId: string;
  /** Canonical outer run id. */
  runId: string;
  /** Side-effect-free route context for agent selection (built by preflight). */
  routeContext: ChannelAgentRouteContext;
  /** The outer run input. */
  input: RunAgentInput;
  /**
   * The Channel turn body. Runs with the resolved, cloned, canonical-thread
   * agent and the outer run's {@link AgentTurnController} (which the body uses
   * to drive inner agent invocations + provider rendering). Invoked exactly
   * once, inside the fenced outer run.
   */
  runTurn: (
    agent: AbstractAgent,
    controller: AgentTurnController,
  ) => Promise<void>;
}

/**
 * Execute one Channel turn:
 *
 * 1. Resolve the selection — reuse the durably-pinned key on retry/failover, or
 *    run the binding's selection ONCE and pin it before anything runs.
 * 2. Drive the pinned agent through one fenced outer run: `resolveAgent` clones
 *    the agent on the execution path and the turn body runs against it.
 *
 * Rejects (without pinning or starting the run) if selection fails, and
 * propagates any failure from the outer run so the caller can nack/retry — the
 * selection stays pinned so the retry resolves the same agent.
 */
export async function executeChannelTurn(
  agentRunner: AgentRunner,
  pins: ChannelSelectionPinStore,
  req: ChannelTurnRequest,
): Promise<void> {
  // 1. Selection: honor a prior pin (retry/failover) before selecting fresh.
  let selectionKey = await pins.get(req.turnKey);
  if (selectionKey === undefined) {
    const selection = await req.binding.selectAgent(req.routeContext);
    selectionKey = selection.key;
    // Pin BEFORE the run so a failed/redelivered turn resolves the same agent.
    await pins.set(req.turnKey, selectionKey);
  }
  const pinnedKey = selectionKey;

  // 2. Fenced outer run: resolve (clone + canonical thread) on the execution
  // path, then run the turn body against it.
  await new Promise<void>((resolve, reject) => {
    agentRunner
      .execute({
        threadId: req.threadId,
        runId: req.runId,
        input: req.input,
        turn: async (controller) => {
          const agent = await req.binding.resolveAgent({
            selectionKey: pinnedKey,
            threadId: req.threadId,
            runId: req.runId,
          });
          await req.runTurn(agent, controller);
        },
      })
      .subscribe({ error: reject, complete: resolve });
  });
}
