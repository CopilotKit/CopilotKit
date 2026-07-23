import type { IngressSink, IncomingTurn } from "@copilotkit/channels-core";
import type {
  TeamsConnector,
  TeamsActivityPayload,
  TeamsSendTarget,
  TeamsOutboundFile,
  TeamsIngressConfig,
  TeamsIngressConnection,
} from "../teams-connector.js";

/** One recorded call to a {@link FakeTeamsConnector} op, in call order. */
export type TeamsConnectorCall =
  | {
      op: "sendActivity";
      target: TeamsSendTarget;
      payload: TeamsActivityPayload;
    }
  | {
      op: "updateActivity";
      target: TeamsSendTarget;
      id: string;
      payload: TeamsActivityPayload;
    }
  | { op: "deleteActivity"; target: TeamsSendTarget; id: string }
  | { op: "sendTyping"; target: TeamsSendTarget }
  | { op: "sendFile"; target: TeamsSendTarget; file: TeamsOutboundFile };

/**
 * Per-op canned responses / failures a test can set on a
 * {@link FakeTeamsConnector} before exercising it. Anything left unset falls
 * back to a harmless default (an incrementing fake activity id, etc.).
 */
export interface FakeTeamsConnectorResults {
  /** Ops (by name) that should reject instead of resolving, with the given error. */
  throwing?: Partial<Record<TeamsConnectorCall["op"], Error>>;
}

/**
 * Records every call made to it (op + exact args, in order) and resolves with
 * configurable canned responses — the TDD fixture proving `TeamsAdapter`'s
 * egress methods route to the right {@link TeamsConnector} op with the right
 * args, without a real (or CloudAdapter-shaped fake) Teams API underneath.
 */
export class FakeTeamsConnector implements TeamsConnector {
  readonly calls: TeamsConnectorCall[] = [];
  private seq = 0;
  /** Set by {@link startIngress}; readable so a test can assert on the config it was handed. */
  ingressConfig: TeamsIngressConfig | undefined;
  /** True once {@link stopIngress} has been called. */
  ingressStopped = false;
  /**
   * Captured from {@link TeamsIngressConfig.sink} by {@link startIngress} —
   * the SAME `IngressSink` a real CloudAdapter-backed connector would forward
   * normalized turns to. Lets {@link emitTurn} push a fake inbound turn
   * straight into the real channels-core dispatch (`sink.onTurn` → §2
   * `decideChannelResponse` → `thread.runAgent` → egress) without a real HTTP
   * listener — the Model-1 standalone proof.
   */
  private sink: IngressSink | undefined;

  constructor(readonly results: FakeTeamsConnectorResults = {}) {}

  private throwIfConfigured(op: TeamsConnectorCall["op"]): void {
    const err = this.results.throwing?.[op];
    if (err) throw err;
  }

  async sendActivity(
    target: TeamsSendTarget,
    payload: TeamsActivityPayload,
  ): Promise<string> {
    this.calls.push({ op: "sendActivity", target, payload });
    this.throwIfConfigured("sendActivity");
    return `fake-activity-${++this.seq}`;
  }

  async updateActivity(
    target: TeamsSendTarget,
    id: string,
    payload: TeamsActivityPayload,
  ): Promise<void> {
    this.calls.push({ op: "updateActivity", target, id, payload });
    this.throwIfConfigured("updateActivity");
  }

  async deleteActivity(target: TeamsSendTarget, id: string): Promise<void> {
    this.calls.push({ op: "deleteActivity", target, id });
    this.throwIfConfigured("deleteActivity");
  }

  async sendTyping(target: TeamsSendTarget): Promise<void> {
    this.calls.push({ op: "sendTyping", target });
    this.throwIfConfigured("sendTyping");
  }

  async sendFile(
    target: TeamsSendTarget,
    file: TeamsOutboundFile,
  ): Promise<string> {
    this.calls.push({ op: "sendFile", target, file });
    this.throwIfConfigured("sendFile");
    return `fake-file-${++this.seq}`;
  }

  /**
   * No real CloudAdapter/HTTP listener here — records the config it was
   * handed (so a test can assert on `files`/`recordUser`) and captures
   * `config.sink` (see {@link emitTurn}) so a test can drive fake inbound
   * turns through it. Raw Teams-shaped ingress (activities/card actions) is
   * still exercised against `CloudAdapterTeamsConnector` directly — this fake
   * only proves what happens AFTER a turn reaches the sink.
   */
  async startIngress(
    config: TeamsIngressConfig,
  ): Promise<TeamsIngressConnection> {
    this.ingressConfig = config;
    this.sink = config.sink;
    return {};
  }

  async stopIngress(): Promise<void> {
    this.ingressStopped = true;
  }

  /**
   * Push a fake inbound turn through the `sink` captured by {@link startIngress}
   * — the Model-1 standalone proof's ingress entry point. Returns the
   * underlying `sink.onTurn` promise (rather than firing-and-forgetting) so a
   * test can `await` a turn all the way through §2's `decideChannelResponse` →
   * `thread.runAgent` → egress before asserting.
   *
   * Throws if ingress hasn't started yet (`channel.start()`/`TeamsAdapter.start()`
   * not called) — this proves the standalone dispatch wiring, so a call before
   * `start()` is a test bug, not a tolerable no-op.
   */
  emitTurn(
    turn: Partial<IncomingTurn> & { conversationKey: string },
  ): Promise<void> {
    if (!this.sink) {
      throw new Error(
        "FakeTeamsConnector.emitTurn: ingress not started — call " +
          "channel.start() (which calls TeamsAdapter.start()) first",
      );
    }
    return Promise.resolve(
      this.sink.onTurn({
        replyTarget: { conversationKey: turn.conversationKey, reference: {} },
        userText: "",
        platform: "teams",
        ...turn,
      }),
    );
  }
}
