import { randomUUID } from "node:crypto";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { RealtimeGatewayPushError } from "./realtime-gateway.js";
import {
  CHANNEL_DELIVERY_PROTOCOL,
  assertDeliveryPacket,
  assertProviderReference,
  deliveryPayloadDigest,
} from "./delivery-contracts.js";
import type {
  ChannelDeliveryPacket,
  ChannelDeliveryPacketAck,
  ChannelProviderPayload,
  ChannelTerminalPayload,
} from "./delivery-contracts.js";
import { ChannelDeliveryFileClient } from "./delivery-files.js";
import type { ChannelFileRef } from "./delivery-files.js";
import { buildContentParts } from "./content-parts.js";

const INVITATION_EVENT = "delivery_invitation";
const CLAIM_EVENT = "claim";
const JOIN_TOKEN_EVENT = "join_token";
const PACKET_EVENT = "packet";

export type ChannelDeliveryAdapter = "slack" | "teams";

export type ChannelDeliveryTurnInput =
  | { kind: "text"; text?: string; files?: ChannelFileRef[] }
  | {
      kind: "command";
      command: string;
      text?: string;
      triggerId?: string;
      rawOptions?: Record<string, unknown>;
    }
  | {
      kind: "reaction";
      rawEmoji: string;
      added: boolean;
      messageId: string;
      messageRef: { id: string };
      postedRef?: string;
    }
  | {
      kind: "interaction";
      actionId: string;
      value?: unknown;
      messageRef?: { id: string };
      triggerId?: string;
    };

export interface PreparedChannelDelivery {
  protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
  deliveryId: string;
  deliveryExpiresAt: string;
  canonicalThreadId: string;
  appUserId: string;
  channelId: string;
  channelName: string;
  adapter: ChannelDeliveryAdapter;
  turn: {
    eventId: string;
    receivedAt: string;
    input: ChannelDeliveryTurnInput;
    actor?: {
      externalUserId: string;
      displayName?: string;
    };
  };
}

type ProviderPayloadInput = ChannelProviderPayload;

interface DeliveryOwner {
  readonly ownerGeneration: number;
  readonly runtimeInstanceId: string;
}

/** Gateway result for a provider call that already recorded delivery terminal state. */
export class ChannelProviderDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly status: string,
  ) {
    super(`Channel provider delivery ended with ${code}`);
    this.name = "ChannelProviderDeliveryError";
  }
}

/**
 * Promise wrapper that records whether handler code observed a rejection.
 */
class ObservableTrackedPromise<T> extends Promise<T> {
  static get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  constructor(
    private readonly operation: Promise<T>,
    private readonly observeRejection: () => void,
  ) {
    super((resolve, reject) => operation.then(resolve, reject));
    void Promise.prototype.then.call(this, undefined, () => undefined);
  }

  // oxlint-disable-next-line unicorn/no-thenable -- This Promise subclass observes handler rejection consumption.
  override then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (onrejected) this.observeRejection();
    return new ObservableTrackedPromise(
      this.operation.then(onfulfilled, onrejected),
      this.observeRejection,
    );
  }

  override catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    if (onrejected) this.observeRejection();
    return new ObservableTrackedPromise(
      this.operation.catch(onrejected),
      this.observeRejection,
    );
  }

  override finally(onfinally?: (() => void) | null): Promise<T> {
    return new ObservableTrackedPromise(
      this.operation.finally(onfinally),
      this.observeRejection,
    );
  }
}

/** One claimed delivery and its exact unacknowledged packet. */
export class ChannelDeliverySession {
  private nextSeq = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private channel: RealtimeGatewayDeliveryChannel;
  private unacknowledgedPacket?: ChannelDeliveryPacket;
  private readonly trackedOperations = new Set<Promise<unknown>>();
  private readonly unobservedOperationFailures = new Map<
    Promise<unknown>,
    unknown
  >();
  private trackedOperationsSealed = false;
  private providerOutputApplied = false;
  /** After a successful terminal or permanent non-terminal failure, refuse further effects. */
  private effectsClosed = false;
  /** After a successful terminal apply, refuse all further packets. */
  private terminalApplied = false;
  private owner: DeliveryOwner;

  constructor(
    readonly delivery: PreparedChannelDelivery,
    owner: DeliveryOwner,
    channel: RealtimeGatewayDeliveryChannel,
    private readonly reconnect: () => Promise<{
      channel: RealtimeGatewayDeliveryChannel;
      owner: DeliveryOwner;
      deliveryExpiresAt?: string;
    }>,
    private readonly files?: ChannelDeliveryFileClient,
  ) {
    this.owner = owner;
    this.channel = channel;
  }

  /** Refresh ownership metadata after a successful join_token reconnect. */
  updateOwner(owner: DeliveryOwner, deliveryExpiresAt?: string): void {
    this.owner = owner;
    if (
      deliveryExpiresAt !== undefined &&
      Number.isFinite(Date.parse(deliveryExpiresAt))
    ) {
      (this.delivery as { deliveryExpiresAt: string }).deliveryExpiresAt =
        deliveryExpiresAt;
    }
  }

  /** Send one provider-ready payload after the previous packet is applied. */
  effect(
    responseId: string,
    payload: ProviderPayloadInput,
  ): Promise<Record<string, unknown>> {
    return this.enqueue(responseId, payload).then((result) => {
      const error =
        typeof result.error === "string" ? result.error : undefined;
      const status =
        typeof result.status === "string" ? result.status : undefined;
      if (
        error !== undefined ||
        status === "failed" ||
        status === "failed_before_output" ||
        status === "uncertain"
      ) {
        // Gateway applied a terminal provider failure — seal further effects
        // (a local terminal is still allowed unless gateway already terminalled).
        this.effectsClosed = true;
        throw new ChannelProviderDeliveryError(
          error ?? "provider_failed",
          status ?? "failed",
        );
      }
      this.providerOutputApplied = true;
      return result;
    });
  }

  /** Send the final outcome through the same ordered packet path. */
  async terminal(payload: Omit<ChannelTerminalPayload, "kind">): Promise<void> {
    await this.sealAndWaitForTrackedOperations(payload.status === "complete");
    // Terminal remains sendable after effect failures so claimAndHandle can
    // report failed/uncertain; only a successful terminal seals the session.
    await this.enqueue("response_terminal", {
      kind: "channel.delivery.terminal",
      ...payload,
    });
    this.terminalApplied = true;
    this.effectsClosed = true;
  }

  /** Return whether at least one provider packet reached the applied phase. */
  hasProviderOutput(): boolean {
    return this.providerOutputApplied;
  }

  /**
   * Register one public Thread operation before it reaches its first await.
   */
  trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.trackedOperationsSealed) {
      const error = new Error(
        `Channel delivery ${this.delivery.deliveryId} no longer accepts Thread operations`,
      );
      error.name = "ChannelDeliveryOperationsClosedError";
      const rejected = Promise.reject<T>(error);
      void rejected.catch(() => undefined);
      return rejected;
    }

    let resolveTracked!: (value: T | PromiseLike<T>) => void;
    let rejectTracked!: (reason?: unknown) => void;
    const tracked = new Promise<T>((resolve, reject) => {
      resolveTracked = resolve;
      rejectTracked = reject;
    });
    this.trackedOperations.add(tracked);
    let rejectionObserved = false;
    void tracked.then(
      () => this.trackedOperations.delete(tracked),
      (error: unknown) => {
        this.trackedOperations.delete(tracked);
        if (!rejectionObserved) {
          this.unobservedOperationFailures.set(tracked, error);
        }
      },
    );

    try {
      void operation().then(resolveTracked, rejectTracked);
    } catch (error) {
      rejectTracked(error);
    }
    return new ObservableTrackedPromise(tracked, () => {
      rejectionObserved = true;
      this.unobservedOperationFailures.delete(tracked);
    });
  }

  /** Hydrate inbound file handles through app-api. */
  getContentParts(
    files: ChannelFileRef[] | undefined,
    log?: (message: string, meta?: unknown) => void,
  ): Promise<AgentContentPart[]> {
    return buildContentParts(
      files,
      this.files?.fetchFile.bind(this.files),
      log,
    );
  }

  /** Upload outbound bytes and return an opaque handle for a provider packet. */
  async uploadFile(args: {
    bytes: Uint8Array;
    filename: string;
    title?: string;
    altText?: string;
  }): Promise<string> {
    if (!this.files) {
      throw new Error("Channel file upload is not configured");
    }
    const uploaded = await this.files.uploadFile(
      this.delivery.deliveryId,
      args,
    );
    return uploaded.handle;
  }

  leave(): void {
    this.channel.leave();
  }

  private async sealAndWaitForTrackedOperations(
    throwOnFailure: boolean,
  ): Promise<void> {
    this.trackedOperationsSealed = true;
    while (this.trackedOperations.size > 0) {
      await Promise.allSettled(this.trackedOperations);
    }
    const failure = this.unobservedOperationFailures.values().next().value;
    this.unobservedOperationFailures.clear();
    if (throwOnFailure && failure !== undefined) throw failure;
  }

  private enqueue(
    responseId: string,
    payload: ChannelProviderPayload | ChannelTerminalPayload,
  ): Promise<Record<string, unknown>> {
    const isTerminal = payload.kind === "channel.delivery.terminal";
    const operation = this.tail.then(async () => {
      if (this.terminalApplied) {
        throw new Error(
          `Channel delivery ${this.delivery.deliveryId} packet path is closed`,
        );
      }
      if (!isTerminal && this.effectsClosed) {
        throw new Error(
          `Channel delivery ${this.delivery.deliveryId} packet path is closed`,
        );
      }
      const packet = this.buildPacket(responseId, payload);
      this.unacknowledgedPacket = packet;
      try {
        // sendExactPacket retries the exact packet across soft transport
        // reconnects; permanent non-terminal failures seal further effects
        // but leave the path open for a terminal outcome packet.
        const acknowledgement = await this.sendExactPacket(packet);
        this.assertExactAcknowledgement(packet, acknowledgement);
        this.unacknowledgedPacket = undefined;
        this.nextSeq += 1;
        return acknowledgement.result;
      } catch (error) {
        this.unacknowledgedPacket = undefined;
        if (!isTerminal) {
          this.effectsClosed = true;
        }
        throw error;
      }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private buildPacket(
    responseId: string,
    payload: ChannelProviderPayload | ChannelTerminalPayload,
  ): ChannelDeliveryPacket {
    if (
      payload.kind !== "channel.delivery.terminal" &&
      !payload.kind.startsWith(`${this.delivery.adapter}.`)
    ) {
      throw new TypeError("provider payload adapter does not match delivery");
    }
    const packet: ChannelDeliveryPacket = {
      protocol: CHANNEL_DELIVERY_PROTOCOL,
      deliveryId: this.delivery.deliveryId,
      runtimeInstanceId: this.owner.runtimeInstanceId,
      ownerGeneration: this.owner.ownerGeneration,
      seq: this.nextSeq,
      effectId: `eff_${randomUUID().replaceAll("-", "")}`,
      responseId,
      payloadDigest: deliveryPayloadDigest(payload),
      payload,
    };
    assertDeliveryPacket(packet);
    return packet;
  }

  private async sendExactPacket(
    packet: ChannelDeliveryPacket,
  ): Promise<ChannelDeliveryPacketAck> {
    let attempt = 0;
    while (Date.now() < Date.parse(this.delivery.deliveryExpiresAt)) {
      try {
        return (await this.channel.push(
          PACKET_EVENT,
          packet,
        )) as ChannelDeliveryPacketAck;
      } catch (error) {
        if (error instanceof RealtimeGatewayPushError) throw error;
        // Claim/join validation failures are permanent — do not thrash reconnect.
        if (
          error instanceof TypeError ||
          (error instanceof Error &&
            /invalid delivery claim|invalid prepared delivery|cannot join deliveries/i.test(
              error.message,
            ))
        ) {
          throw error;
        }
        attempt += 1;
        // Bound reconnect thrash: exponential backoff capped at 5s.
        const delayMs = Math.min(5_000, 50 * 2 ** Math.min(attempt, 6));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (Date.now() >= Date.parse(this.delivery.deliveryExpiresAt)) break;
        const refreshed = await this.reconnect();
        this.channel = refreshed.channel;
        this.updateOwner(refreshed.owner, refreshed.deliveryExpiresAt);
      }
    }
    throw new Error("Channel delivery ownership expired");
  }

  private assertExactAcknowledgement(
    packet: ChannelDeliveryPacket,
    acknowledgement: ChannelDeliveryPacketAck,
  ): void {
    if (
      acknowledgement?.phase !== "applied" ||
      acknowledgement.deliveryId !== packet.deliveryId ||
      acknowledgement.seq !== packet.seq ||
      acknowledgement.effectId !== packet.effectId ||
      acknowledgement.responseId !== packet.responseId ||
      acknowledgement.payloadDigest !== packet.payloadDigest ||
      typeof acknowledgement.result !== "object" ||
      acknowledgement.result === null
    ) {
      throw new TypeError(
        "Gateway returned a conflicting packet acknowledgement",
      );
    }
    const reference = acknowledgement.result.providerReference;
    if (reference !== undefined) assertProviderReference(reference);
  }
}

interface ClaimResult {
  result?: "claimed" | "lost";
  deliveryId: string;
  ownerGeneration?: number;
  joinToken?: string;
  deliveryExpiresAt?: string;
}

export interface ChannelDeliveryTransportOptions {
  session: RealtimeGatewaySession;
  runtimeInstanceId: string;
  appApiBaseUrl?: string;
  apiKey?: string;
  fileFetch?: typeof fetch;
  log?: (message: string, meta?: unknown) => void;
}

/** Claims invitations and runs each delivery on its one-use delivery topic. */
export class ChannelDeliveryTransport {
  private readonly active = new Map<string, Promise<void>>();
  private readonly files?: ChannelDeliveryFileClient;
  private stopped = false;
  private invitationHandler?: (value: unknown) => void;
  private started = false;
  /** Latest handler; invitation callback always reads this so re-start re-arms. */
  private deliveryHandler?: (
    session: ChannelDeliverySession,
    delivery: PreparedChannelDelivery,
  ) => Promise<void>;

  constructor(private readonly options: ChannelDeliveryTransportOptions) {
    if (options.appApiBaseUrl && options.apiKey) {
      this.files = new ChannelDeliveryFileClient({
        baseUrl: options.appApiBaseUrl,
        apiKey: options.apiKey,
        ...(options.fileFetch ? { fetch: options.fileFetch } : {}),
      });
    } else if (options.appApiBaseUrl || options.apiKey) {
      options.log?.(
        "channel delivery file client disabled: both appApiBaseUrl and apiKey are required",
      );
    }
  }

  start(
    handler: (
      session: ChannelDeliverySession,
      delivery: PreparedChannelDelivery,
    ) => Promise<void>,
  ): void {
    this.stopped = false;
    this.deliveryHandler = handler;
    if (this.started && this.invitationHandler) {
      // Re-arm without stacking Phoenix handlers on start→stop→start.
      return;
    }
    this.started = true;
    this.invitationHandler = (value) => {
      if (
        this.stopped ||
        !isInvitation(value) ||
        this.active.has(value.deliveryId) ||
        !this.deliveryHandler
      ) {
        return;
      }
      const activeHandler = this.deliveryHandler;
      // Register into active before any await so stop() waits for this delivery.
      const running = this.claimAndHandle(
        value.deliveryId,
        activeHandler,
      ).finally(() => this.active.delete(value.deliveryId));
      this.active.set(value.deliveryId, running);
    };
    this.options.session.on(INVITATION_EVENT, this.invitationHandler);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled(this.active.values());
  }

  private async claimAndHandle(
    deliveryId: string,
    handler: (
      session: ChannelDeliverySession,
      delivery: PreparedChannelDelivery,
    ) => Promise<void>,
  ): Promise<void> {
    try {
      const claim = (await this.options.session.push(CLAIM_EVENT, {
        protocol: CHANNEL_DELIVERY_PROTOCOL,
        deliveryId,
        runtimeInstanceId: this.options.runtimeInstanceId,
      })) as ClaimResult;
      if (claim.result !== "claimed") return;
      const owner = assertClaim(
        claim,
        deliveryId,
        this.options.runtimeInstanceId,
      );
      let joined = await this.joinDelivery(deliveryId, owner, claim.joinToken!);
      const delivery = assertPreparedDelivery(joined.joinReply, deliveryId);
      const reconnect = async (): Promise<{
        channel: RealtimeGatewayDeliveryChannel;
        owner: DeliveryOwner;
        deliveryExpiresAt?: string;
      }> => {
        joined.leave();
        const refreshed = assertClaim(
          (await this.options.session.push(JOIN_TOKEN_EVENT, {
            protocol: CHANNEL_DELIVERY_PROTOCOL,
            deliveryId,
            runtimeInstanceId: this.options.runtimeInstanceId,
          })) as ClaimResult,
          deliveryId,
          this.options.runtimeInstanceId,
        );
        joined = await this.joinDelivery(
          deliveryId,
          refreshed,
          refreshed.joinToken!,
        );
        const rejoinDelivery = assertPreparedDelivery(
          joined.joinReply,
          deliveryId,
        );
        return {
          channel: joined,
          owner: {
            ownerGeneration: refreshed.ownerGeneration,
            runtimeInstanceId: refreshed.runtimeInstanceId,
          },
          deliveryExpiresAt: rejoinDelivery.deliveryExpiresAt,
        };
      };
      const session = new ChannelDeliverySession(
        delivery,
        owner,
        joined,
        reconnect,
        this.files,
      );
      try {
        await handler(session, delivery);
        await session.terminal({
          status: "complete",
          code: "provider_delivery_complete",
        });
      } catch (error) {
        if (!(error instanceof ChannelProviderDeliveryError)) {
          await session
            .terminal({
              status: session.hasProviderOutput()
                ? "failed"
                : "failed_before_output",
              code: "runtime_handler_failed",
            })
            .catch(() => undefined);
        }
        this.options.log?.("channel delivery handler failed", {
          deliveryId,
          ...safeChannelErrorMetadata(error),
        });
      } finally {
        session.leave();
      }
    } catch (error) {
      this.options.log?.("channel delivery claim or join failed", {
        deliveryId,
        ...safeChannelErrorMetadata(error),
      });
    }
  }

  private joinDelivery(
    deliveryId: string,
    owner: DeliveryOwner & { joinToken?: string },
    joinToken: string,
  ): Promise<RealtimeGatewayDeliveryChannel> {
    if (!this.options.session.join) {
      throw new Error(
        "Realtime Gateway control session cannot join deliveries",
      );
    }
    return this.options.session.join(`delivery:${deliveryId}`, {
      protocol: CHANNEL_DELIVERY_PROTOCOL,
      deliveryId,
      runtimeInstanceId: owner.runtimeInstanceId,
      ownerGeneration: owner.ownerGeneration,
      joinToken,
    });
  }
}

/** Map arbitrary failures to fixed-cardinality safe log metadata. */
export function safeChannelErrorMetadata(error: unknown): {
  errorCategory:
    | "auth"
    | "network"
    | "timeout"
    | "validation"
    | "conflict"
    | "unknown";
} {
  const value = error as { name?: unknown; code?: unknown } | null;
  const classification =
    `${String(value?.name ?? "")} ${String(value?.code ?? "")}`.toLowerCase();
  if (/timeout|expired|deadline/.test(classification)) {
    return { errorCategory: "timeout" };
  }
  if (/network|fetch|econn|enotfound|socket|dns|epipe/.test(classification)) {
    return { errorCategory: "network" };
  }
  if (
    /auth|unauthorized|forbidden|token|credential|401|403/.test(classification)
  ) {
    return { errorCategory: "auth" };
  }
  if (/conflict|sequence|packet/.test(classification)) {
    return { errorCategory: "conflict" };
  }
  if (/type|valid|schema|parse/.test(classification)) {
    return { errorCategory: "validation" };
  }
  return { errorCategory: "unknown" };
}

function assertClaim(
  claim: ClaimResult,
  deliveryId: string,
  runtimeInstanceId: string,
): DeliveryOwner & { joinToken: string } {
  if (
    claim.result !== "claimed" ||
    claim.deliveryId !== deliveryId ||
    !Number.isInteger(claim.ownerGeneration) ||
    (claim.ownerGeneration ?? 0) < 1 ||
    typeof claim.joinToken !== "string" ||
    !claim.joinToken.startsWith("chj_")
  ) {
    throw new TypeError("Gateway returned an invalid delivery claim");
  }
  return {
    ownerGeneration: claim.ownerGeneration!,
    runtimeInstanceId,
    joinToken: claim.joinToken,
  };
}

const PREPARED_TURN_KINDS = new Set([
  "text",
  "command",
  "reaction",
  "interaction",
]);

function assertPreparedDelivery(
  value: unknown,
  deliveryId: string,
): PreparedChannelDelivery {
  if (!isRecord(value)) {
    throw new TypeError("Gateway returned an invalid prepared delivery");
  }
  const prepared = value as Partial<PreparedChannelDelivery>;
  if (
    prepared.protocol !== CHANNEL_DELIVERY_PROTOCOL ||
    prepared.deliveryId !== deliveryId ||
    typeof prepared.deliveryExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(prepared.deliveryExpiresAt)) ||
    typeof prepared.channelId !== "string" ||
    typeof prepared.channelName !== "string" ||
    typeof prepared.canonicalThreadId !== "string" ||
    typeof prepared.appUserId !== "string" ||
    (prepared.adapter !== "slack" && prepared.adapter !== "teams") ||
    !isRecord(prepared.turn) ||
    typeof prepared.turn.eventId !== "string" ||
    typeof prepared.turn.receivedAt !== "string" ||
    !isRecord(prepared.turn.input) ||
    typeof prepared.turn.input.kind !== "string" ||
    !PREPARED_TURN_KINDS.has(prepared.turn.input.kind)
  ) {
    throw new TypeError("Gateway returned an invalid prepared delivery");
  }
  return prepared as PreparedChannelDelivery;
}

function isInvitation(value: unknown): value is {
  protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
  deliveryId: string;
} {
  return (
    isRecord(value) &&
    value.protocol === CHANNEL_DELIVERY_PROTOCOL &&
    typeof value.deliveryId === "string" &&
    value.deliveryId.startsWith("dlv_")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
