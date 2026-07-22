import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { ChannelRunner } from "./channel-runner";
import type {
  ChannelRunnerStartRequest,
  RuntimeChannelBinding,
} from "./channel-runner";
import type { AgentTurnController } from "./agent-runner";
import type { ChannelsControl, ChannelStatus } from "../core/channel-manager";
import { buildChannelRouteContext } from "./channel-preflight";
import type { ChannelDeliveryEnvelope } from "./channel-preflight";
import {
  InMemorySelectionPinStore,
  executeChannelTurn,
} from "./execute-channel-turn";
import type { ChannelSelectionPinStore } from "./execute-channel-turn";

/**
 * The production {@link ChannelRunner} for Intelligence-delivered Channels
 * (Task 1/8). With Intelligence configured, the Runtime always creates this
 * runner; it drives each compiled {@link RuntimeChannelBinding} through the
 * per-turn core ({@link executeChannelTurn}) over one fenced
 * {@link AgentRunner.execute} run.
 *
 * Connectivity is injected as a {@link ChannelConnectivity} port. The PRODUCTION
 * port (Realtime Gateway deliveries + Connector Outbox rendering, reached via
 * the same dynamic-import seam the {@link ChannelManager} uses) is intentionally
 * NOT wired here yet: its exact shape depends on the planned §2 spec / an
 * Intelligence-side delivery API (review assumption A9, Tasks 5-7). This port +
 * the {@link ChannelDelivery} contract are DERIVED and must be reconciled before
 * the beta cut. Isolating connectivity behind the port keeps the runner's
 * contract-fixed orchestration (preflight → select/pin/resolve → execute →
 * ack/nack) testable and correctable independent of that reconciliation.
 *
 * Concurrency (`binding.decideConcurrency` + an in-flight-per-conversation
 * replace/queue/drop barrier) is a deliberate FOLLOW-UP slice — it needs the
 * per-conversation threadId/abort model nailed against the connectivity
 * contract. `@internal`.
 */

/**
 * One inbound Channel turn handed to the runner by the connectivity port. It
 * carries the bounded envelope (→ route context), the canonical run identity,
 * the run input, a `runTurn` body that runs the resolved agent WITH provider
 * rendering + the tool loop, and the delivery ack/nack the runner drives from
 * turn success/failure. DERIVED (A9) — reconcile before beta.
 */
export interface ChannelDelivery {
  readonly envelope: ChannelDeliveryEnvelope;
  readonly threadId: string;
  readonly runId: string;
  /** Stable pinning key for this turn (reused verbatim on redelivery). */
  readonly turnKey: string;
  readonly input: RunAgentInput;
  /** Run the resolved, cloned agent for this turn (provider rendering + tools). */
  runTurn(agent: AbstractAgent, controller: AgentTurnController): Promise<void>;
  /** Acknowledge successful processing (lease release). */
  ack(): Promise<void>;
  /** Negatively acknowledge — redelivered at-least-once. */
  nack(reason: string): Promise<void>;
}

/** Handle returned by {@link ChannelConnectivity.start}. */
export interface ChannelConnectivityHandle {
  /** Stop delivering and release transports. Idempotent. */
  stop(): Promise<void>;
}

/**
 * The connectivity the runner owns: start delivering turns for the named
 * Channels, invoking `onDelivery` once per leased turn. Production supplies the
 * Realtime Gateway / Connector Outbox implementation (deferred; see the class
 * docstring — A9).
 */
export interface ChannelConnectivity {
  start(
    channelNames: readonly string[],
    onDelivery: (delivery: ChannelDelivery) => Promise<void>,
  ): Promise<ChannelConnectivityHandle>;
}

/** Constructor arguments for {@link IntelligenceChannelRunner}. */
export interface IntelligenceChannelRunnerArgs {
  /** The connectivity port (production: gateway/outbox; tests: in-memory). */
  connectivity: ChannelConnectivity;
  /** Durable selection-pin store. Defaults to process-local in-memory. */
  pins?: ChannelSelectionPinStore;
}

export class IntelligenceChannelRunner extends ChannelRunner {
  private readonly connectivity: ChannelConnectivity;
  private readonly pins: ChannelSelectionPinStore;

  constructor(args: IntelligenceChannelRunnerArgs) {
    super();
    this.connectivity = args.connectivity;
    this.pins = args.pins ?? new InMemorySelectionPinStore();
  }

  start(request: ChannelRunnerStartRequest): ChannelsControl {
    const { agentRunner } = request;
    const bindings = new Map<string, RuntimeChannelBinding>();
    for (const binding of request.bindings) {
      const name = binding.channel.name;
      if (!name) {
        throw new Error(
          "IntelligenceChannelRunner: a RuntimeChannelBinding has an unnamed " +
            "Channel — every Channel driven by the runner must have a name.",
        );
      }
      bindings.set(name, binding);
    }

    let stopped = false;
    let handle: ChannelConnectivityHandle | undefined;

    const onDelivery = async (delivery: ChannelDelivery): Promise<void> => {
      // A delivery arriving after stop() has nothing live to run against.
      if (stopped) {
        await delivery.nack("runner stopped");
        return;
      }
      const binding = bindings.get(delivery.envelope.channelName);
      if (!binding) {
        // Fail loud, never silently ack an unroutable delivery.
        await delivery.nack(
          `no Channel named "${delivery.envelope.channelName}" is registered on this runner`,
        );
        return;
      }
      // Per-delivery abort for the side-effect-free selection preflight. (Unifying
      // this with the execute()-level turn abort is a concurrency follow-up.)
      const abort = new AbortController();
      const routeContext = buildChannelRouteContext(
        delivery.envelope,
        abort.signal,
      );
      try {
        await executeChannelTurn(agentRunner, this.pins, {
          binding,
          turnKey: delivery.turnKey,
          threadId: delivery.threadId,
          runId: delivery.runId,
          routeContext,
          input: delivery.input,
          runTurn: delivery.runTurn,
        });
        await delivery.ack();
      } catch (err) {
        await delivery.nack(err instanceof Error ? err.message : String(err));
      }
    };

    // Activation is async; ready() awaits it. A stop() that races the startup
    // tears the handle down as soon as it resolves.
    const startup = this.connectivity
      .start([...bindings.keys()], onDelivery)
      .then((h) => {
        if (stopped) {
          void h.stop();
          return;
        }
        handle = h;
      });
    startup.catch(() => {});

    const statusMap = (): Record<string, ChannelStatus> => {
      const status: ChannelStatus = stopped ? "stopped" : "online";
      const channels: Record<string, ChannelStatus> = {};
      for (const name of bindings.keys()) {
        channels[name] = status;
      }
      return channels;
    };

    return {
      ready: async () => {
        await startup;
      },
      status: () => ({
        overall: stopped ? "stopped" : "online",
        channels: statusMap(),
      }),
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        // Wait out an in-flight startup so a late-resolving handle is torn down.
        await startup.catch(() => {});
        await handle?.stop();
      },
    };
  }
}
