import { randomUUID } from "node:crypto";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import type { MessageOperation } from "@copilotkit/channels-ui";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { RealtimeGatewayPushError } from "./realtime-gateway.js";
import {
  CHANNEL_DELIVERY_PROTOCOL,
  assertDeliveryPacket,
  assertProviderReference,
} from "./delivery-contracts.js";
import type {
  ChannelDeliveryPacket,
  ChannelDeliveryPacketAck,
  ChannelDeliveryPayload,
  ChannelProviderPayload,
  ChannelTerminalPayload,
} from "./delivery-contracts.js";
import { ChannelDeliveryFileClient } from "./delivery-files.js";
import {
  ChannelDeliveryTranscriptClient,
  ChannelDeliveryTranscriptError,
} from "./delivery-transcript.js";
import type { ChannelDeliveryTranscript } from "./delivery-transcript.js";
import { ChannelDeliveryChargeClient } from "./delivery-charge.js";
import type { ChannelFileRef } from "./delivery-files.js";
import { buildContentParts } from "./content-parts.js";

const INVITATION_EVENT = "delivery_invitation";
const CLAIM_EVENT = "claim";
const CAPACITY_OVERFLOW_EVENT = "claim_overflow";
const JOIN_TOKEN_EVENT = "join_token";
const DEFAULT_MAX_CONCURRENT_DELIVERIES = 8;
const DEFAULT_MAX_PENDING_DELIVERIES = 32;
const DEFERRED_CLAIM_RETRY_MS = 50;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const PACKET_EVENT = "packet";

export type ChannelDeliveryAdapter = "slack" | "teams";

export type ChannelDeliveryTurnInput =
  | {
      kind: "text";
      text?: string;
      files?: ChannelFileRef[];
      operation: MessageOperation;
    }
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
  /** Trusted inbound Slack surface; omitted for providers without this concept. */
  surfaceKind?: "direct_message" | "app_mention" | "message";
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

class ChannelDeliveryStoppedError extends Error {
  constructor() {
    super("Channel delivery stopped");
    this.name = "ChannelDeliveryStoppedError";
  }
}

function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw new ChannelDeliveryStoppedError();
}

function waitUnlessStopped(ms: number, signal: AbortSignal): Promise<void> {
  throwIfStopped(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new ChannelDeliveryStoppedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
export class ClaimedChannelDelivery {
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
  private transcriptPromise?: Promise<ChannelDeliveryTranscript>;
  private chargePromise?: Promise<void>;
  private commitPromise?: Promise<void>;
  private transcriptTriggerPersisted = false;
  private providerOutputApplied = false;
  /** After a successful terminal or permanent non-terminal failure, refuse further effects. */
  private effectsClosed = false;
  /** After a successful terminal apply, refuse all further packets. */
  private terminalApplied = false;
  private owner: DeliveryOwner;
  private left = false;
  private readonly abortController = new AbortController();
  readonly signal: AbortSignal;
  supersededByDeliveryId?: string;
  private readonly stopFromParent: () => void;

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
    private readonly transcripts?: ChannelDeliveryTranscriptClient,
    private readonly parentSignal: AbortSignal = new AbortController().signal,
    private readonly charges?: Pick<ChannelDeliveryChargeClient, "charge">,
  ) {
    this.owner = owner;
    this.channel = channel;
    this.signal = this.abortController.signal;
    this.stopFromParent = () => this.abortController.abort("stopped");
    if (parentSignal.aborted) {
      this.stopFromParent();
    } else {
      parentSignal.addEventListener("abort", this.stopFromParent, {
        once: true,
      });
    }
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
    _responseId: string,
    payload: ProviderPayloadInput,
    options: { charge?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const charged =
      options.charge === false ? Promise.resolve() : this.charge();
    return charged
      .then(() => this.enqueue(payload))
      .then((result) => {
        const error =
          typeof result.error === "string" ? result.error : undefined;
        const status =
          typeof result.status === "string" ? result.status : undefined;
        // Only explicit terminal statuses mean the gateway already terminalled.
        if (
          status === "failed" ||
          status === "failed_before_output" ||
          status === "uncertain"
        ) {
          this.effectsClosed = true;
          throw new ChannelProviderDeliveryError(
            error ?? "provider_failed",
            status,
          );
        }
        const capabilityError =
          typeof result.capabilityError === "string"
            ? result.capabilityError
            : undefined;
        if (
          payload.kind === "teams.image.create" &&
          capabilityError === "teams_image_rejected"
        ) {
          return result;
        }
        // Cleanup stream.stop must not count as user-visible provider output —
        // otherwise failed-before-output terminals misclassify after stop-only.
        const kind =
          typeof payload.kind === "string" ? payload.kind : undefined;
        if (
          kind === undefined ||
          (kind !== "slack.thread.status" && !kind.endsWith(".stream.stop"))
        ) {
          this.providerOutputApplied = true;
        }
        return result;
      });
  }

  /** Idempotently charge this delivery before its first substantive work. */
  charge(): Promise<void> {
    if (!this.charges) {
      // Direct/self-hosted transports do not use Intelligence metering.
      return Promise.resolve();
    }
    this.chargePromise ??= this.charges.charge(this.delivery.deliveryId);
    return this.chargePromise;
  }

  /** Atomically fence this delivery before its first local irreversible work. */
  commit(): Promise<void> {
    this.commitPromise ??= this.enqueue({
      kind: "channel.delivery.commit",
    }).then(() => undefined);
    return this.commitPromise;
  }

  /** Abort this exact delivery after Redis selected a newer switchable owner. */
  supersede(supersededByDeliveryId: string): void {
    if (this.signal.aborted) return;
    this.supersededByDeliveryId = supersededByDeliveryId;
    this.abortController.abort("superseded");
  }

  isSuperseded(): boolean {
    return this.signal.aborted && this.signal.reason === "superseded";
  }

  /** Send the final outcome through the same ordered packet path. */
  async terminal(payload: Omit<ChannelTerminalPayload, "kind">): Promise<void> {
    await this.sealAndWaitForTrackedOperations(payload.status === "complete");
    // Terminal remains sendable after effect failures so claimAndHandle can
    // report failed/uncertain; only a successful terminal seals the delivery.
    await this.enqueue({
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

  /** Load and memoize one delivery-scoped provider transcript promise. */
  getTranscript(): Promise<ChannelDeliveryTranscript> {
    if (!this.transcripts) {
      return Promise.reject(
        new Error("Channel transcript requires both appApiBaseUrl and apiKey"),
      );
    }
    this.transcriptPromise ??= this.transcripts.fetchTranscript(
      this.delivery.deliveryId,
    );
    return this.transcriptPromise;
  }

  /** Return true exactly once so the canonical run persists one trigger input. */
  consumeTranscriptTriggerPersistence(): boolean {
    if (this.transcriptTriggerPersisted) return false;
    this.transcriptTriggerPersisted = true;
    return true;
  }

  /** Upload outbound bytes and return an opaque handle for a provider packet. */
  async uploadFile(
    operationId: string,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<string> {
    if (!this.files) {
      throw new Error("Channel file upload is not configured");
    }
    const uploaded = await this.files.uploadFile(
      this.delivery.deliveryId,
      operationId,
      args,
    );
    return uploaded.handle;
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    this.parentSignal.removeEventListener("abort", this.stopFromParent);
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
    payload: ChannelDeliveryPayload,
  ): Promise<Record<string, unknown>> {
    const isTerminal = payload.kind === "channel.delivery.terminal";
    // Stream stop must remain sendable after mid-stream effect failure so
    // providers do not leave an open native stream (confirmation r4).
    const isStreamStop =
      typeof payload.kind === "string" && payload.kind.endsWith(".stream.stop");
    const isCleanupPacket = isTerminal || isStreamStop;
    const operation = this.tail.then(async () => {
      if (this.terminalApplied) {
        throw new Error(
          `Channel delivery ${this.delivery.deliveryId} packet path is closed`,
        );
      }
      if (!isCleanupPacket && this.effectsClosed) {
        throw new Error(
          `Channel delivery ${this.delivery.deliveryId} packet path is closed`,
        );
      }
      const packet = this.buildPacket(payload);
      this.unacknowledgedPacket = packet;
      try {
        // sendExactPacket retries the exact packet across soft transport
        // reconnects; permanent non-cleanup failures seal further effects
        // but leave the path open for terminal + stream.stop packets.
        const acknowledgement = await this.sendExactPacket(packet);
        this.assertExactAcknowledgement(packet, acknowledgement);
        this.unacknowledgedPacket = undefined;
        this.nextSeq += 1;
        return acknowledgement.result;
      } catch (error) {
        this.unacknowledgedPacket = undefined;
        if (!isCleanupPacket) {
          this.effectsClosed = true;
        }
        throw error;
      }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private buildPacket(payload: ChannelDeliveryPayload): ChannelDeliveryPacket {
    if (
      payload.kind !== "channel.delivery.terminal" &&
      payload.kind !== "channel.delivery.commit" &&
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
      packetId: `pkt_${randomUUID().replaceAll("-", "")}`,
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
      throwIfStopped(this.signal);
      try {
        const acknowledgement = (await this.channel.push(
          PACKET_EVENT,
          packet,
        )) as ChannelDeliveryPacketAck;
        this.assertExactAcknowledgement(packet, acknowledgement);
        if (acknowledgement.phase !== "retry_wait") {
          return acknowledgement;
        }
        const retryAtMs = Date.parse(acknowledgement.retryAt ?? "");
        await waitUnlessStopped(
          Math.max(0, retryAtMs - Date.now()),
          this.signal,
        );
      } catch (error) {
        if (error instanceof ChannelDeliveryStoppedError) throw error;
        if (error instanceof RealtimeGatewayPushError) throw error;
        // Claim/join validation failures are permanent — do not thrash reconnect.
        if (
          error instanceof TypeError ||
          (error instanceof Error &&
            /invalid delivery claim|invalid prepared delivery|cannot join deliveries|delivery join failed|delivery join timed out/i.test(
              error.message,
            ))
        ) {
          throw error;
        }
        attempt += 1;
        // Bound reconnect thrash: exponential backoff capped at 5s.
        const delayMs = Math.min(5_000, 50 * 2 ** Math.min(attempt, 6));
        await waitUnlessStopped(delayMs, this.signal);
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
      !["applied", "retry_wait", "failed", "uncertain"].includes(
        acknowledgement?.phase,
      ) ||
      acknowledgement.deliveryId !== packet.deliveryId ||
      acknowledgement.seq !== packet.seq ||
      acknowledgement.packetId !== packet.packetId ||
      typeof acknowledgement.result !== "object" ||
      acknowledgement.result === null
    ) {
      throw new TypeError(
        "Gateway returned a conflicting packet acknowledgement",
      );
    }
    if (
      acknowledgement.phase === "retry_wait" &&
      !Number.isFinite(Date.parse(acknowledgement.retryAt ?? ""))
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
  result?: "claimed" | "lost" | "deferred";
  deliveryId: string;
  activeDeliveryId?: string;
  ownerGeneration?: number;
  joinToken?: string;
  deliveryExpiresAt?: string;
}

export interface ChannelDeliveryTransportOptions {
  session: RealtimeGatewaySession;
  runtimeInstanceId: string;
  /** Maximum deliveries this Runtime may claim and execute at once. */
  maxConcurrentDeliveries?: number;
  /** Maximum claimed or claiming deliveries waiting for an execution slot. */
  maxPendingDeliveries?: number;
  appApiBaseUrl?: string;
  apiKey?: string;
  fileFetch?: typeof fetch;
  log?: (message: string, meta?: unknown) => void;
}

/** Claims invitations and runs each delivery on its one-use delivery topic. */
export class ChannelDeliveryTransport {
  private readonly active = new Map<string, Promise<void>>();
  private readonly activeDeliveries = new Map<string, ClaimedChannelDelivery>();
  private readonly threadTails = new Map<string, Promise<void>>();
  private readonly executionWaiters: Array<{
    signal: AbortSignal;
    resolve: (release: () => void) => void;
  }> = [];
  private runningExecutions = 0;
  private readonly files?: ChannelDeliveryFileClient;
  private readonly transcripts?: ChannelDeliveryTranscriptClient;
  private readonly charges?: ChannelDeliveryChargeClient;
  private readonly maxConcurrentDeliveries: number;
  private readonly maxPendingDeliveries: number;
  private stopped = false;
  private abortController = new AbortController();
  private invitationHandler?: (value: unknown) => void;
  private started = false;
  /** Latest handler; invitation callback always reads this so re-start re-arms. */
  private deliveryHandler?: (
    claimedDelivery: ClaimedChannelDelivery,
    delivery: PreparedChannelDelivery,
  ) => Promise<void>;

  constructor(private readonly options: ChannelDeliveryTransportOptions) {
    this.maxConcurrentDeliveries =
      options.maxConcurrentDeliveries ?? DEFAULT_MAX_CONCURRENT_DELIVERIES;
    this.maxPendingDeliveries =
      options.maxPendingDeliveries ?? DEFAULT_MAX_PENDING_DELIVERIES;
    if (
      !Number.isSafeInteger(this.maxConcurrentDeliveries) ||
      this.maxConcurrentDeliveries < 1
    ) {
      throw new TypeError(
        "maxConcurrentDeliveries must be a positive safe integer",
      );
    }
    if (
      !Number.isSafeInteger(this.maxPendingDeliveries) ||
      this.maxPendingDeliveries < 1
    ) {
      throw new TypeError(
        "maxPendingDeliveries must be a positive safe integer",
      );
    }
    if (options.appApiBaseUrl && options.apiKey) {
      this.files = new ChannelDeliveryFileClient({
        baseUrl: options.appApiBaseUrl,
        apiKey: options.apiKey,
        ...(options.fileFetch ? { fetch: options.fileFetch } : {}),
      });
      this.transcripts = new ChannelDeliveryTranscriptClient({
        baseUrl: options.appApiBaseUrl,
        apiKey: options.apiKey,
        ...(options.fileFetch ? { fetch: options.fileFetch } : {}),
      });
      this.charges = new ChannelDeliveryChargeClient({
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
      claimedDelivery: ClaimedChannelDelivery,
      delivery: PreparedChannelDelivery,
    ) => Promise<void>,
  ): void {
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
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
      if (
        this.active.size >=
        this.maxConcurrentDeliveries + this.maxPendingDeliveries
      ) {
        this.reportCapacityOverflow(value.deliveryId, value.canonicalThreadId);
        return;
      }
      const activeHandler = this.deliveryHandler;
      const signal = this.abortController.signal;
      const predecessor =
        this.threadTails.get(value.canonicalThreadId) ?? Promise.resolve();
      // Register into active before any await so stop() waits for this delivery.
      let running!: Promise<void>;
      running = this.claimAndHandle(
        value.deliveryId,
        activeHandler,
        signal,
        predecessor,
      ).finally(() => {
        this.active.delete(value.deliveryId);
        if (this.threadTails.get(value.canonicalThreadId) === running) {
          this.threadTails.delete(value.canonicalThreadId);
        }
      });
      this.active.set(value.deliveryId, running);
      this.threadTails.set(value.canonicalThreadId, running);
    };
    this.options.session.on(INVITATION_EVENT, this.invitationHandler);
  }

  private reportCapacityOverflow(
    deliveryId: string,
    canonicalThreadId: string,
  ): void {
    void this.options.session
      .push(CAPACITY_OVERFLOW_EVENT, {
        protocol: CHANNEL_DELIVERY_PROTOCOL,
        deliveryId,
        runtimeInstanceId: this.options.runtimeInstanceId,
      })
      .then((value: unknown) => {
        const result =
          isRecord(value) && typeof value.result === "string"
            ? value.result
            : "unknown";
        this.options.log?.("channel delivery capacity overflow", {
          outcome: result,
          reason: "runtime_capacity_overflow",
          deliveryId,
          canonicalThreadId,
        });
      })
      .catch(() => {
        this.options.log?.("channel delivery capacity overflow", {
          outcome: "report_failed",
          reason: "runtime_capacity_overflow",
          deliveryId,
          canonicalThreadId,
        });
      });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortController.abort();
    for (const delivery of this.activeDeliveries.values()) delivery.leave();
    const active = [...this.active.values()];
    if (active.length === 0) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      void Promise.allSettled(active).then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async claimAndHandle(
    deliveryId: string,
    handler: (
      claimedDelivery: ClaimedChannelDelivery,
      delivery: PreparedChannelDelivery,
    ) => Promise<void>,
    signal: AbortSignal,
    predecessor: Promise<void>,
  ): Promise<void> {
    try {
      let claim: ClaimResult;
      do {
        claim = (await this.options.session.push(CLAIM_EVENT, {
          protocol: CHANNEL_DELIVERY_PROTOCOL,
          deliveryId,
          runtimeInstanceId: this.options.runtimeInstanceId,
        })) as ClaimResult;
        if (claim.result === "deferred") {
          await waitUnlessStopped(DEFERRED_CLAIM_RETRY_MS, signal);
        }
      } while (claim.result === "deferred");
      if (claim.result !== "claimed") return;
      throwIfStopped(signal);
      const owner = assertClaim(
        claim,
        deliveryId,
        this.options.runtimeInstanceId,
      );
      let joined = await this.joinDelivery(deliveryId, owner, claim.joinToken!);
      let delivery: PreparedChannelDelivery;
      try {
        delivery = assertPreparedDelivery(joined.joinReply, deliveryId);
      } catch (error) {
        try {
          joined.leave();
        } catch {
          // Best-effort leave after invalid join reply.
        }
        throw error;
      }
      let claimedDelivery: ClaimedChannelDelivery | undefined;
      const observeSupersession = (
        channel: RealtimeGatewayDeliveryChannel,
      ): void => {
        channel.on("delivery_superseded", (value: unknown) => {
          if (
            isSupersession(value, deliveryId) &&
            claimedDelivery !== undefined
          ) {
            claimedDelivery.supersede(value.supersededByDeliveryId);
          }
        });
      };
      const reconnect = async (): Promise<{
        channel: RealtimeGatewayDeliveryChannel;
        owner: DeliveryOwner;
        deliveryExpiresAt?: string;
      }> => {
        const previous = joined;
        const refreshed = assertClaim(
          (await this.options.session.push(JOIN_TOKEN_EVENT, {
            protocol: CHANNEL_DELIVERY_PROTOCOL,
            deliveryId,
            runtimeInstanceId: this.options.runtimeInstanceId,
          })) as ClaimResult,
          deliveryId,
          this.options.runtimeInstanceId,
        );
        const next = await this.joinDelivery(
          deliveryId,
          refreshed,
          refreshed.joinToken!,
        );
        try {
          previous.leave();
        } catch {
          // Prefer the new join; leaving the old topic is best-effort.
        }
        joined = next;
        observeSupersession(joined);
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
      claimedDelivery = new ClaimedChannelDelivery(
        delivery,
        owner,
        joined,
        reconnect,
        this.files,
        this.transcripts,
        signal,
        this.charges,
      );
      observeSupersession(joined);
      this.activeDeliveries.set(deliveryId, claimedDelivery);
      let releaseExecution: (() => void) | undefined;
      try {
        await predecessor;
        throwIfStopped(claimedDelivery.signal);
        releaseExecution = await this.acquireExecutionSlot(
          claimedDelivery.signal,
        );
        await handler(claimedDelivery, delivery);
        await claimedDelivery.terminal({
          status: "complete",
          code: "provider_delivery_complete",
        });
      } catch (error) {
        if (
          !(error instanceof ChannelProviderDeliveryError) &&
          !claimedDelivery.isSuperseded()
        ) {
          if (
            error instanceof ChannelDeliveryTranscriptError &&
            shouldReportTranscriptFailure(delivery)
          ) {
            await claimedDelivery
              .effect(
                "transcript_failure",
                {
                  kind: "slack.message.create",
                  text: "An error occurred processing this request.",
                },
                { charge: false },
              )
              .catch(() => undefined);
          }
          await claimedDelivery
            .terminal({
              status: claimedDelivery.hasProviderOutput()
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
        releaseExecution?.();
        this.activeDeliveries.delete(deliveryId);
        claimedDelivery.leave();
      }
    } catch (error) {
      this.options.log?.("channel delivery claim or join failed", {
        deliveryId,
        ...safeChannelErrorMetadata(error),
      });
    }
  }

  private acquireExecutionSlot(signal: AbortSignal): Promise<() => void> {
    throwIfStopped(signal);
    if (this.runningExecutions < this.maxConcurrentDeliveries) {
      this.runningExecutions += 1;
      return Promise.resolve(this.executionRelease());
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.executionWaiters.findIndex(
          (waiter) => waiter.resolve === resolve,
        );
        if (index >= 0) this.executionWaiters.splice(index, 1);
        reject(new ChannelDeliveryStoppedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.executionWaiters.push({
        signal,
        resolve: (release) => {
          signal.removeEventListener("abort", onAbort);
          resolve(release);
        },
      });
    });
  }

  private executionRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.executionWaiters.length > 0) {
        const waiter = this.executionWaiters.shift()!;
        if (waiter.signal.aborted) continue;
        waiter.resolve(this.executionRelease());
        return;
      }
      this.runningExecutions -= 1;
    };
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

function isSupersession(
  value: unknown,
  deliveryId: string,
): value is {
  deliveryId: string;
  supersededByDeliveryId: string;
  reason: "superseded";
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { deliveryId?: unknown }).deliveryId === deliveryId &&
    typeof (value as { supersededByDeliveryId?: unknown })
      .supersededByDeliveryId === "string" &&
    (value as { reason?: unknown }).reason === "superseded"
  );
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
  const value = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
  } | null;
  const message =
    error instanceof Error
      ? error.message
      : typeof value?.message === "string"
        ? value.message
        : "";
  const classification =
    `${String(value?.name ?? "")} ${String(value?.code ?? "")} ${message}`.toLowerCase();
  if (/timeout|expired|deadline|timed out/.test(classification)) {
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
const PREPARED_SURFACE_KINDS = new Set([
  "direct_message",
  "app_mention",
  "message",
]);

function shouldReportTranscriptFailure(
  delivery: PreparedChannelDelivery,
): boolean {
  if (delivery.adapter !== "slack") return false;
  if (
    delivery.surfaceKind === "direct_message" ||
    delivery.surfaceKind === "app_mention"
  ) {
    return true;
  }
  const input = delivery.turn.input;
  return input.kind === "text" && input.operation.mentioned;
}

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
    (prepared.surfaceKind !== undefined &&
      (typeof prepared.surfaceKind !== "string" ||
        !PREPARED_SURFACE_KINDS.has(prepared.surfaceKind))) ||
    !isRecord(prepared.turn) ||
    typeof prepared.turn.eventId !== "string" ||
    typeof prepared.turn.receivedAt !== "string" ||
    !isRecord(prepared.turn.input) ||
    typeof prepared.turn.input.kind !== "string" ||
    !PREPARED_TURN_KINDS.has(prepared.turn.input.kind) ||
    !isValidPreparedTurnInput(prepared.turn.input)
  ) {
    throw new TypeError("Gateway returned an invalid prepared delivery");
  }
  return prepared as PreparedChannelDelivery;
}

/** Per-kind required fields for prepared turn input (join-boundary fail-fast). */
function isValidPreparedTurnInput(input: Record<string, unknown>): boolean {
  switch (input.kind) {
    case "text":
      return true;
    case "command":
      return typeof input.command === "string" && input.command.length > 0;
    case "reaction":
      return (
        typeof input.rawEmoji === "string" &&
        input.rawEmoji.length > 0 &&
        typeof input.messageId === "string" &&
        input.messageId.length > 0 &&
        typeof input.added === "boolean"
      );
    case "interaction":
      return typeof input.actionId === "string" && input.actionId.length > 0;
    default:
      return false;
  }
}

function isInvitation(value: unknown): value is {
  protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
  deliveryId: string;
  canonicalThreadId: string;
} {
  return (
    isRecord(value) &&
    value.protocol === CHANNEL_DELIVERY_PROTOCOL &&
    typeof value.deliveryId === "string" &&
    value.deliveryId.startsWith("dlv_") &&
    typeof value.canonicalThreadId === "string" &&
    value.canonicalThreadId.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
