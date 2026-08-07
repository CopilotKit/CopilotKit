import { randomUUID } from "node:crypto";
import {
  ChannelDeliveryTerminatedError,
  isChannelDeliveryTerminatedError,
} from "@copilotkit/channels-core";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import type { MessageOperation } from "@copilotkit/channels-ui";
import type { ChannelScheduledTask } from "@copilotkit/channels-core";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { RealtimeGatewayPushError } from "./realtime-gateway.js";
import {
  CHANNEL_DELIVERY_PROTOCOL,
  DISCORD_DELIVERY_CAPABILITY,
  SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY,
  assertDeliveryPacket,
  assertProviderMessageId,
  assertProviderReference,
  isProviderMessageId,
  isValidReactionName,
} from "./delivery-contracts.js";
import type {
  ChannelDeliveryPacket,
  ChannelDeliveryPacketAck,
  ChannelDeliveryPayload,
  ChannelProviderPayload,
  ChannelTerminalPayload,
} from "./delivery-contracts.js";
import { ChannelDeliveryFileClient } from "./delivery-files.js";
import { ChannelDeliveryTranscriptClient } from "./delivery-transcript.js";
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

export type ChannelDeliveryAdapter = "slack" | "teams" | "discord";

export type ChannelDeliveryTurnInput =
  | {
      kind: "text";
      text: string;
      files?: ChannelFileRef[];
      operation: MessageOperation;
      messageRef: { id: string };
    }
  | {
      kind: "reaction";
      rawEmoji: string;
      added: boolean;
      messageId: string;
      messageRef: { id: string };
    }
  | {
      kind: "interaction";
      actionId: string;
      submissionKind?: "modal" | "portable_input";
      value?: unknown;
      values?: Record<string, unknown>;
      modalFiles?: Record<string, ChannelFileRef[]>;
      messageRef?: { id: string };
      triggerId?: string;
    }
  | {
      kind: "welcome";
    }
  | {
      kind: "file_consent";
      action: "accept" | "decline";
      fileHandle: string;
    }
  | {
      kind: "scheduled_task";
      scheduledAt: string;
      task: ChannelScheduledTask;
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
  capabilities?: readonly (
    | typeof SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY
    | typeof DISCORD_DELIVERY_CAPABILITY
  )[];
  surfaceId: string;
  tenant?: { id: string; name?: string };
  installation?: { id: string };
  conversation?: { id: string; kind?: string };
  /** Trusted provider surface used to decide whether a response is expected. */
  surfaceKind?:
    | "direct_message"
    | "app_mention"
    | "message"
    | "personal"
    | "mention"
    | "ambient"
    | "interaction"
    | "welcome"
    | "reaction"
    | "file_consent";
  turn: {
    eventId: string;
    receivedAt: string;
    typingDelayMs?: 0 | 300;
    input: ChannelDeliveryTurnInput;
    actor?: {
      externalUserId: string;
      kind: "human" | "bot" | "app" | "system" | "unknown";
      displayName?: string;
      handle?: string;
      email?: string;
    };
    raw?: unknown;
  };
}

type ProviderPayloadInput = ChannelProviderPayload;

export interface ChannelProviderDeliveryDetails {
  readonly category: "validation";
  readonly provider: "slack" | "teams";
  readonly operation: string;
  readonly effectKind: string;
  readonly providerCode: "invalid_arguments" | "invalid_blocks";
  readonly validationMessages: readonly string[];
  readonly retryable: false;
  readonly deliveryId: string;
}

interface DeliveryOwner {
  readonly ownerGeneration: number;
  readonly runtimeInstanceId: string;
}

/** Gateway result for a provider call that already recorded delivery terminal state. */
export class ChannelProviderDeliveryError extends ChannelDeliveryTerminatedError {
  readonly category?: ChannelProviderDeliveryDetails["category"];
  readonly provider?: ChannelProviderDeliveryDetails["provider"];
  readonly operation?: string;
  readonly effectKind?: string;
  readonly providerCode?: ChannelProviderDeliveryDetails["providerCode"];
  readonly validationMessages?: readonly string[];
  readonly retryable?: false;
  readonly deliveryId?: string;

  constructor(
    readonly code: string,
    readonly status: string,
    readonly details?: ChannelProviderDeliveryDetails,
  ) {
    super(
      `Channel provider delivery ended with ${code}`,
      details ? { cause: details, details } : undefined,
    );
    this.name = "ChannelProviderDeliveryError";
    if (details) {
      this.category = details.category;
      this.provider = details.provider;
      this.operation = details.operation;
      this.effectKind = details.effectKind;
      this.providerCode = details.providerCode;
      this.validationMessages = details.validationMessages;
      this.retryable = details.retryable;
      this.deliveryId = details.deliveryId;
    }
  }
}

/** A provider-native effect or element was used for a different active provider. */
export class ChannelProviderMismatchError extends TypeError {
  readonly code = "CHANNEL_PROVIDER_MISMATCH";

  constructor(
    readonly activeProvider: ChannelDeliveryAdapter,
    readonly requestedProvider: ChannelDeliveryAdapter,
    readonly source: "effect" | "element",
  ) {
    super(
      `Cannot send a ${requestedProvider} ${source} through an active ${activeProvider} delivery`,
    );
    this.name = "ChannelProviderMismatchError";
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
  private providerOutputExpected = false;
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
      capabilities?: PreparedChannelDelivery["capabilities"];
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
  updateOwner(
    owner: DeliveryOwner,
    deliveryExpiresAt?: string,
    capabilities?: PreparedChannelDelivery["capabilities"],
  ): void {
    this.owner = owner;
    if (capabilities === undefined) {
      delete (this.delivery as { capabilities?: unknown }).capabilities;
    } else {
      (
        this.delivery as {
          capabilities?: PreparedChannelDelivery["capabilities"];
        }
      ).capabilities = capabilities;
    }
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
    options: { charge?: boolean; bestEffort?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (isVisibleProviderEffect(payload)) {
      this.providerOutputExpected = true;
    }
    const requestedProvider = providerForEffect(payload);
    if (requestedProvider !== this.delivery.adapter) {
      return Promise.reject(
        new ChannelProviderMismatchError(
          this.delivery.adapter,
          requestedProvider,
          "effect",
        ),
      );
    }
    const charged =
      options.charge === false ? Promise.resolve() : this.charge();
    return charged
      .then(() => this.enqueue(payload, options.bestEffort === true))
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
          if (
            options.bestEffort === true ||
            payload.kind === "slack.thread.status"
          ) {
            throw new Error(
              `Channel provider effect failed with ${error ?? "provider_failed"}`,
            );
          }
          this.effectsClosed = true;
          throw new ChannelProviderDeliveryError(
            error ?? "provider_failed",
            status,
            parseProviderDeliveryDetails(result.details),
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

  /** Mark that handler code explicitly attempted visible provider output. */
  expectProviderOutput(): void {
    this.providerOutputExpected = true;
  }

  /** Return whether this delivery's handler explicitly attempted visible output. */
  hasExpectedProviderOutput(): boolean {
    return this.providerOutputExpected;
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
    this.transcriptPromise ??= this.transcripts
      .fetchTranscript(this.delivery.deliveryId)
      .then((transcript) =>
        restorePreparedTriggerFiles(transcript, this.delivery.turn.input),
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
    bestEffort = false,
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
        if (
          !isCleanupPacket &&
          !bestEffort &&
          payload.kind !== "slack.thread.status"
        ) {
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
    let pendingPacket = packet;
    while (Date.now() < Date.parse(this.delivery.deliveryExpiresAt)) {
      throwIfStopped(this.signal);
      try {
        const acknowledgement = (await this.channel.push(
          PACKET_EVENT,
          pendingPacket,
        )) as ChannelDeliveryPacketAck;
        this.assertExactAcknowledgement(pendingPacket, acknowledgement);
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
        this.updateOwner(
          refreshed.owner,
          refreshed.deliveryExpiresAt,
          refreshed.capabilities,
        );
        pendingPacket = packet;
        if (
          packet.payload.kind === "slack.stream.append" &&
          packet.payload.fullText !== undefined &&
          !refreshed.capabilities?.includes(
            SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY,
          )
        ) {
          const { fullText: _fullText, ...legacyPayload } = packet.payload;
          pendingPacket = { ...packet, payload: legacyPayload };
        }
      }
    }
    throw new Error("Channel delivery ownership expired");
  }

  private assertExactAcknowledgement(
    packet: ChannelDeliveryPacket,
    acknowledgement: ChannelDeliveryPacketAck,
  ): void {
    if (
      !isRecord(acknowledgement) ||
      !hasExactFields(
        acknowledgement,
        ["deliveryId", "seq", "packetId", "phase", "result"],
        ["retryAt"],
      ) ||
      !["applied", "retry_wait", "failed", "uncertain"].includes(
        String(acknowledgement.phase),
      ) ||
      acknowledgement.deliveryId !== packet.deliveryId ||
      acknowledgement.seq !== packet.seq ||
      acknowledgement.packetId !== packet.packetId ||
      !isRecord(acknowledgement.result) ||
      (acknowledgement.phase === "retry_wait") !==
        (acknowledgement.retryAt !== undefined) ||
      (acknowledgement.retryAt !== undefined &&
        !isIsoDateTime(acknowledgement.retryAt))
    ) {
      throw new TypeError(
        "Gateway returned a conflicting packet acknowledgement",
      );
    }
    const reference = acknowledgement.result.providerReference;
    if (reference !== undefined) assertProviderReference(reference);
    const providerMessageId = acknowledgement.result.providerMessageId;
    if (providerMessageId !== undefined) {
      assertProviderMessageId(providerMessageId);
    }
    if (acknowledgement.result.details !== undefined) {
      const details = parseProviderDeliveryDetails(
        acknowledgement.result.details,
      );
      if (!details || details.deliveryId !== packet.deliveryId) {
        throw new TypeError("Gateway returned unsafe provider diagnostics");
      }
    }
  }
}

function parseProviderDeliveryDetails(
  value: unknown,
): ChannelProviderDeliveryDetails | undefined {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "category",
      "provider",
      "operation",
      "effectKind",
      "providerCode",
      "validationMessages",
      "retryable",
      "deliveryId",
    ]) ||
    value.category !== "validation" ||
    (value.provider !== "slack" &&
      value.provider !== "teams" &&
      value.provider !== "discord") ||
    typeof value.operation !== "string" ||
    value.operation.length === 0 ||
    value.operation.length > 80 ||
    typeof value.effectKind !== "string" ||
    value.effectKind.length === 0 ||
    value.effectKind.length > 80 ||
    (value.providerCode !== "invalid_arguments" &&
      value.providerCode !== "invalid_blocks") ||
    value.retryable !== false ||
    typeof value.deliveryId !== "string" ||
    value.deliveryId.length === 0 ||
    value.deliveryId.length > 512 ||
    !Array.isArray(value.validationMessages) ||
    value.validationMessages.length > 5 ||
    !value.validationMessages.every(
      (message) =>
        typeof message === "string" &&
        message.length <= 256 &&
        message.startsWith("invalid field at /"),
    )
  ) {
    return undefined;
  }
  return value as unknown as ChannelProviderDeliveryDetails;
}

function restorePreparedTriggerFiles(
  transcript: ChannelDeliveryTranscript,
  input: PreparedChannelDelivery["turn"]["input"],
): ChannelDeliveryTranscript {
  if (input.kind !== "text" || !input.files?.length) return transcript;
  const files = input.files.map((file) => ({
    providerFileId: `managed:${file.handle}`.slice(0, 512),
    name: file.filename,
    mimeType: file.mimeType ?? null,
    byteSize: file.byteSize ?? null,
    availability: "managed" as const,
    handle: file.handle,
  }));
  return {
    ...transcript,
    messages: transcript.messages.map((message) =>
      message.currentTrigger && message.files.length === 0
        ? { ...message, files }
        : message,
    ),
  };
}

type ClaimResult =
  | {
      result: "claimed";
      deliveryId: string;
      ownerGeneration: number;
      joinToken: string;
      joinTokenExpiresAt: string;
      deliveryExpiresAt: string;
      supersededDeliveryId?: string;
    }
  | { result: "lost"; deliveryId: string }
  | {
      result: "deferred";
      deliveryId: string;
      activeDeliveryId: string;
    };

interface JoinTokenResult {
  deliveryId: string;
  ownerGeneration: number;
  joinToken: string;
  joinTokenExpiresAt: string;
  deliveryExpiresAt: string;
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
        this.reportCapacityOverflow(
          value.deliveryId,
          "canonicalThreadId" in value
            ? value.canonicalThreadId
            : value.deliveryId,
        );
        return;
      }
      const admissionKey =
        "canonicalThreadId" in value
          ? value.canonicalThreadId
          : value.deliveryId;
      const activeHandler = this.deliveryHandler;
      const signal = this.abortController.signal;
      const predecessor =
        this.threadTails.get(admissionKey) ?? Promise.resolve();
      // Register into active before any await so stop() waits for this delivery.
      let running!: Promise<void>;
      running = this.claimAndHandle(
        value.deliveryId,
        activeHandler,
        signal,
        predecessor,
      ).finally(() => {
        this.active.delete(value.deliveryId);
        if (this.threadTails.get(admissionKey) === running) {
          this.threadTails.delete(admissionKey);
        }
      });
      this.active.set(value.deliveryId, running);
      this.threadTails.set(admissionKey, running);
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
        claim = assertClaimResult(
          await this.options.session.push(CLAIM_EVENT, {
            protocol: CHANNEL_DELIVERY_PROTOCOL,
            deliveryId,
            runtimeInstanceId: this.options.runtimeInstanceId,
          }),
          deliveryId,
        );
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
        capabilities?: PreparedChannelDelivery["capabilities"];
      }> => {
        const previous = joined;
        const refreshed = assertJoinTokenResult(
          await this.options.session.push(JOIN_TOKEN_EVENT, {
            protocol: CHANNEL_DELIVERY_PROTOCOL,
            deliveryId,
            runtimeInstanceId: this.options.runtimeInstanceId,
          }),
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
          capabilities: rejoinDelivery.capabilities,
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
          !isChannelDeliveryTerminatedError(error) &&
          !claimedDelivery.isSuperseded()
        ) {
          if (shouldSendGenericFailure(delivery, claimedDelivery)) {
            await claimedDelivery
              .effect(
                "expected_response_failure",
                {
                  kind:
                    delivery.adapter === "slack"
                      ? "slack.message.create"
                      : "teams.message.create",
                  text: "Something went wrong",
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
      capabilities: [
        SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY,
        DISCORD_DELIVERY_CAPABILITY,
      ],
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
  provider?: "slack" | "teams";
  operation?: string;
  effectKind?: string;
  providerCode?: "invalid_arguments" | "invalid_blocks";
  retryable?: false;
} {
  if (error instanceof ChannelProviderDeliveryError && error.details) {
    return {
      errorCategory: error.details.category,
      provider: error.details.provider,
      operation: error.details.operation,
      effectKind: error.details.effectKind,
      providerCode: error.details.providerCode,
      retryable: error.details.retryable,
    };
  }
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
  claim: Extract<ClaimResult, { result: "claimed" }>,
  deliveryId: string,
  runtimeInstanceId: string,
): DeliveryOwner & { joinToken: string } {
  return {
    ownerGeneration: claim.ownerGeneration,
    runtimeInstanceId,
    joinToken: claim.joinToken,
  };
}

function assertClaimResult(value: unknown, deliveryId: string): ClaimResult {
  if (!isRecord(value) || value.deliveryId !== deliveryId) {
    throw new TypeError("Gateway returned an invalid delivery claim");
  }
  if (value.result === "lost") {
    if (!hasExactFields(value, ["result", "deliveryId"])) {
      throw new TypeError("Gateway returned an invalid delivery claim");
    }
    return value as ClaimResult;
  }
  if (value.result === "deferred") {
    if (
      !hasExactFields(value, ["result", "deliveryId", "activeDeliveryId"]) ||
      !isDeliveryId(value.activeDeliveryId)
    ) {
      throw new TypeError("Gateway returned an invalid delivery claim");
    }
    return value as ClaimResult;
  }
  if (
    value.result !== "claimed" ||
    !hasExactFields(
      value,
      [
        "result",
        "deliveryId",
        "ownerGeneration",
        "joinToken",
        "joinTokenExpiresAt",
        "deliveryExpiresAt",
      ],
      ["supersededDeliveryId"],
    ) ||
    !Number.isInteger(value.ownerGeneration) ||
    Number(value.ownerGeneration) < 1 ||
    !isJoinToken(value.joinToken) ||
    !isIsoDateTime(value.joinTokenExpiresAt) ||
    !isIsoDateTime(value.deliveryExpiresAt) ||
    (value.supersededDeliveryId !== undefined &&
      !isDeliveryId(value.supersededDeliveryId))
  ) {
    throw new TypeError("Gateway returned an invalid delivery claim");
  }
  return value as ClaimResult;
}

function assertJoinTokenResult(
  value: unknown,
  deliveryId: string,
  runtimeInstanceId: string,
): DeliveryOwner & JoinTokenResult {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "deliveryId",
      "ownerGeneration",
      "joinToken",
      "joinTokenExpiresAt",
      "deliveryExpiresAt",
    ]) ||
    value.deliveryId !== deliveryId ||
    !Number.isInteger(value.ownerGeneration) ||
    Number(value.ownerGeneration) < 1 ||
    !isJoinToken(value.joinToken) ||
    !isIsoDateTime(value.joinTokenExpiresAt) ||
    !isIsoDateTime(value.deliveryExpiresAt)
  ) {
    throw new TypeError("Gateway returned an invalid delivery join token");
  }
  return {
    deliveryId,
    ownerGeneration: Number(value.ownerGeneration),
    runtimeInstanceId,
    joinToken: value.joinToken,
    joinTokenExpiresAt: value.joinTokenExpiresAt,
    deliveryExpiresAt: value.deliveryExpiresAt,
  };
}

const PREPARED_TURN_KINDS = new Set([
  "text",
  "reaction",
  "interaction",
  "welcome",
  "file_consent",
  "scheduled_task",
]);
const PREPARED_SURFACE_KINDS = new Set([
  "direct_message",
  "app_mention",
  "message",
  "personal",
  "mention",
  "ambient",
  "interaction",
  "welcome",
  "reaction",
  "file_consent",
]);

function assertPreparedDelivery(
  value: unknown,
  deliveryId: string,
): PreparedChannelDelivery {
  if (
    !isRecord(value) ||
    !hasExactFields(
      value,
      [
        "protocol",
        "deliveryId",
        "deliveryExpiresAt",
        "channelId",
        "channelName",
        "canonicalThreadId",
        "appUserId",
        "adapter",
        "surfaceId",
        "turn",
      ],
      ["tenant", "installation", "conversation", "surfaceKind", "capabilities"],
    )
  ) {
    throw new TypeError("Gateway returned an invalid prepared delivery");
  }
  const prepared = value as Partial<PreparedChannelDelivery>;
  if (
    prepared.protocol !== CHANNEL_DELIVERY_PROTOCOL ||
    prepared.deliveryId !== deliveryId ||
    !isDeliveryId(prepared.deliveryId) ||
    !isIsoDateTime(prepared.deliveryExpiresAt) ||
    !isChannelId(prepared.channelId) ||
    !isChannelName(prepared.channelName) ||
    !isSurfaceId(prepared.surfaceId) ||
    !isSafeExternalId(prepared.canonicalThreadId) ||
    !isSafeAppUserId(prepared.appUserId) ||
    (prepared.adapter !== "slack" &&
      prepared.adapter !== "teams" &&
      prepared.adapter !== "discord") ||
    (prepared.capabilities !== undefined &&
      (!Array.isArray(prepared.capabilities) ||
        prepared.capabilities.length > 2 ||
        prepared.capabilities.some(
          (capability) =>
            capability !== SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY &&
            capability !== DISCORD_DELIVERY_CAPABILITY,
        ))) ||
    (prepared.tenant !== undefined && !isPreparedTenant(prepared.tenant)) ||
    (prepared.installation !== undefined &&
      !isPreparedInstallation(prepared.installation)) ||
    (prepared.conversation !== undefined &&
      !isPreparedConversation(prepared.conversation)) ||
    (prepared.surfaceKind !== undefined &&
      (typeof prepared.surfaceKind !== "string" ||
        !PREPARED_SURFACE_KINDS.has(prepared.surfaceKind))) ||
    !isRecord(prepared.turn) ||
    !hasExactFields(
      prepared.turn,
      ["eventId", "receivedAt", "input"],
      ["typingDelayMs", "actor", "raw"],
    ) ||
    !isEventId(prepared.turn.eventId) ||
    !isIsoDateTime(prepared.turn.receivedAt) ||
    (prepared.turn.typingDelayMs !== undefined &&
      prepared.turn.typingDelayMs !== 0 &&
      prepared.turn.typingDelayMs !== 300) ||
    (prepared.turn.actor !== undefined &&
      !isPreparedActor(prepared.turn.actor)) ||
    !isRecord(prepared.turn.input) ||
    typeof prepared.turn.input.kind !== "string" ||
    !PREPARED_TURN_KINDS.has(prepared.turn.input.kind) ||
    !isValidPreparedTurnInput(prepared.turn.input) ||
    (prepared.turn.input.kind === "scheduled_task" &&
      prepared.turn.input.task.surfaceId !== prepared.surfaceId)
  ) {
    throw new TypeError("Gateway returned an invalid prepared delivery");
  }
  return prepared as PreparedChannelDelivery;
}

/** Per-kind required fields for prepared turn input (join-boundary fail-fast). */
function isValidPreparedTurnInput(input: Record<string, unknown>): boolean {
  switch (input.kind) {
    case "text":
      return (
        hasExactFields(
          input,
          ["kind", "text", "operation", "messageRef"],
          ["files"],
        ) &&
        isBoundedString(input.text, 0, 40_000) &&
        (input.files === undefined || isPreparedFiles(input.files)) &&
        isPreparedMessageRef(input.messageRef) &&
        isValidMessageOperation(input.operation)
      );
    case "reaction":
      return (
        hasExactFields(input, [
          "kind",
          "rawEmoji",
          "added",
          "messageId",
          "messageRef",
        ]) &&
        isValidReactionName(input.rawEmoji) &&
        isProviderMessageId(input.messageId) &&
        typeof input.added === "boolean" &&
        isPreparedMessageRef(input.messageRef)
      );
    case "interaction":
      return (
        hasExactFields(
          input,
          ["kind", "actionId"],
          [
            "submissionKind",
            "value",
            "values",
            "modalFiles",
            "messageRef",
            "triggerId",
          ],
        ) &&
        isBoundedString(input.actionId, 1, 400) &&
        (input.submissionKind === undefined ||
          input.submissionKind === "modal" ||
          input.submissionKind === "portable_input") &&
        (input.values === undefined || isRecord(input.values)) &&
        (input.modalFiles === undefined ||
          isPreparedModalFiles(input.modalFiles)) &&
        (input.messageRef === undefined ||
          isPreparedMessageRef(input.messageRef)) &&
        (input.triggerId === undefined || isSafeExternalId(input.triggerId))
      );
    case "welcome":
      return hasExactFields(input, ["kind"]);
    case "file_consent":
      return (
        hasExactFields(input, ["kind", "action", "fileHandle"]) &&
        (input.action === "accept" || input.action === "decline") &&
        typeof input.fileHandle === "string" &&
        /^fileref_[A-Za-z0-9_-]+$/.test(input.fileHandle)
      );
    case "scheduled_task":
      return (
        hasExactFields(input, ["kind", "scheduledAt", "task"]) &&
        isIsoDateTime(input.scheduledAt) &&
        isScheduledTask(input.task)
      );
    default:
      return false;
  }
}

function hasExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((field) => Object.hasOwn(value, field)) &&
    Object.keys(value).every((field) => allowed.has(field))
  );
}

function isBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function isDeliveryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 132 &&
    /^dlv_[A-Za-z0-9_-]+$/.test(value)
  );
}

function isJoinToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 4096 &&
    /^chj_[A-Za-z0-9._-]+$/.test(value)
  );
}

function isChannelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 132 &&
    /^channel_[A-Za-z0-9_-]+$/.test(value)
  );
}

/** Validate one opaque Intelligence provider-surface identifier. */
function isSurfaceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 132 &&
    /^surface_[A-Za-z0-9_-]+$/.test(value)
  );
}

function isEventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 132 &&
    /^evt_[A-Za-z0-9_-]+$/.test(value)
  );
}

function isChannelName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 64 &&
    value !== "channels" &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
  );
}

function isSafeExternalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  );
}

const APP_USER_ID_MAX_LENGTH = 2048;

/**
 * Check a server-generated app-user id composed from provider-scoped parts.
 */
function isSafeAppUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= APP_USER_ID_MAX_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)
  );
}

function isPreparedActor(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactFields(
      value,
      ["externalUserId", "kind"],
      ["displayName", "handle", "email"],
    ) &&
    isBoundedString(value.externalUserId, 1, 512) &&
    ["human", "bot", "app", "system", "unknown"].includes(String(value.kind)) &&
    (value.displayName === undefined ||
      (typeof value.displayName === "string" &&
        value.displayName.trim().length >= 1 &&
        value.displayName.trim().length <= 120)) &&
    (value.handle === undefined || isBoundedString(value.handle, 1, 512)) &&
    (value.email === undefined || isBoundedString(value.email, 1, 512))
  );
}

/** Validate the exact scheduled Task snapshot accepted from Gateway. */
function isScheduledTask(value: unknown): value is ChannelScheduledTask {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "id",
      "surfaceId",
      "goal",
      "when",
      "enabled",
      "createdBy",
      "createdAt",
      "updatedAt",
    ]) ||
    typeof value.id !== "string" ||
    !/^task_[A-Za-z0-9_-]+$/.test(value.id) ||
    !isSurfaceId(value.surfaceId) ||
    !isBoundedString(value.goal, 1, 40_000) ||
    value.enabled !== true ||
    !isIsoDateTime(value.createdAt) ||
    !isIsoDateTime(value.updatedAt) ||
    !isRecord(value.when) ||
    !hasExactFields(value.when, ["kind", "cron", "timeZone"]) ||
    value.when.kind !== "schedule" ||
    typeof value.when.cron !== "string" ||
    !/^\S+(?:\s+\S+){4}$/.test(value.when.cron) ||
    !isBoundedString(value.when.timeZone, 1, 128) ||
    !isRecord(value.createdBy)
  ) {
    return false;
  }
  if (value.createdBy.kind === "application") {
    return (
      hasExactFields(value.createdBy, ["kind", "applicationId"]) &&
      isBoundedString(value.createdBy.applicationId, 1, 256)
    );
  }
  if (value.createdBy.kind === "provider_actor") {
    return (
      hasExactFields(value.createdBy, ["kind", "actor"]) &&
      isRecord(value.createdBy.actor) &&
      hasExactFields(
        value.createdBy.actor,
        ["id", "kind"],
        ["displayName", "handle"],
      ) &&
      isBoundedString(value.createdBy.actor.id, 1, 512) &&
      ["human", "bot", "app"].includes(String(value.createdBy.actor.kind))
    );
  }
  return false;
}

function isPreparedTenant(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactFields(value, ["id"], ["name"]) &&
    isBoundedString(value.id, 1, 512) &&
    (value.name === undefined || isBoundedString(value.name, 1, 512))
  );
}

function isPreparedInstallation(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactFields(value, ["id"]) &&
    isBoundedString(value.id, 1, 512)
  );
}

function isPreparedConversation(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactFields(value, ["id"], ["kind"]) &&
    isBoundedString(value.id, 1, 512) &&
    (value.kind === undefined || isBoundedString(value.kind, 1, 120))
  );
}

function isPreparedMessageRef(value: unknown): boolean {
  if (!isRecord(value) || !hasExactFields(value, ["id"])) return false;
  try {
    assertProviderReference(value.id);
    return true;
  } catch {
    return false;
  }
}

function isPreparedFiles(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every(
      (file) =>
        isRecord(file) &&
        hasExactFields(
          file,
          ["handle", "filename"],
          ["mimeType", "byteSize"],
        ) &&
        typeof file.handle === "string" &&
        /^fileref_[A-Za-z0-9_-]+$/.test(file.handle) &&
        typeof file.filename === "string" &&
        file.filename.trim().length >= 1 &&
        file.filename.trim().length <= 120 &&
        (file.mimeType === undefined ||
          isBoundedString(file.mimeType, 0, 255)) &&
        (file.byteSize === undefined ||
          (typeof file.byteSize === "number" &&
            Number.isSafeInteger(file.byteSize) &&
            file.byteSize >= 0)),
    )
  );
}

function isPreparedModalFiles(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length > 20) return false;
  const groups = Object.entries(value);
  return (
    groups.every(
      ([customId, files]) =>
        isBoundedString(customId, 1, 100) && isPreparedFiles(files),
    ) &&
    groups.reduce(
      (count, [, files]) => count + (Array.isArray(files) ? files.length : 0),
      0,
    ) <= 20
  );
}

function isValidMessageOperation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fields = Object.keys(value);
  return (
    fields.length === 4 &&
    fields.every((field) =>
      ["kind", "logicalMessageId", "revisionId", "mentioned"].includes(field),
    ) &&
    ["created", "updated", "deleted"].includes(String(value.kind)) &&
    isProviderMessageId(value.logicalMessageId) &&
    isProviderMessageId(value.revisionId) &&
    typeof value.mentioned === "boolean"
  );
}

function isVisibleProviderEffect(payload: ProviderPayloadInput): boolean {
  const kind = payload.kind;
  return (
    (kind.startsWith("slack.") ||
      kind.startsWith("teams.") ||
      kind.startsWith("discord.")) &&
    kind !== "slack.thread.status" &&
    !kind.endsWith(".stream.stop")
  );
}

/** Resolve the provider encoded in the strict provider-effect discriminator. */
function providerForEffect(
  payload: ProviderPayloadInput,
): ChannelDeliveryAdapter {
  if (payload.kind.startsWith("teams.")) return "teams";
  if (payload.kind.startsWith("discord.")) return "discord";
  return "slack";
}

/** Whether a failed handler owes the participant a generic visible response. */
function shouldSendGenericFailure(
  delivery: PreparedChannelDelivery,
  claimedDelivery: ClaimedChannelDelivery,
): boolean {
  if (claimedDelivery.hasExpectedProviderOutput()) return true;
  if (
    delivery.surfaceKind === "direct_message" ||
    delivery.surfaceKind === "app_mention" ||
    delivery.surfaceKind === "personal" ||
    delivery.surfaceKind === "mention" ||
    delivery.surfaceKind === "interaction" ||
    delivery.surfaceKind === "welcome"
  ) {
    return true;
  }
  const input = delivery.turn.input;
  return (
    input.kind === "welcome" ||
    input.kind === "interaction" ||
    (input.kind === "text" && input.operation.mentioned)
  );
}

type DeliveryInvitation =
  | {
      protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
      deliveryId: string;
      canonicalThreadId: string;
      surfaceId: string;
      channelName: string;
      adapter: ChannelDeliveryAdapter;
    }
  | {
      protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
      kind: "scheduled_task";
      deliveryId: string;
      surfaceId: string;
      channelName: string;
      adapter: ChannelDeliveryAdapter;
    };

/** Validate either a normal Thread invitation or a scheduled Task invitation. */
function isInvitation(value: unknown): value is DeliveryInvitation {
  if (
    !isRecord(value) ||
    value.protocol !== CHANNEL_DELIVERY_PROTOCOL ||
    !isDeliveryId(value.deliveryId) ||
    !isSurfaceId(value.surfaceId) ||
    !isChannelName(value.channelName) ||
    (value.adapter !== "slack" &&
      value.adapter !== "teams" &&
      value.adapter !== "discord")
  ) {
    return false;
  }
  if (value.kind === "scheduled_task") {
    return hasExactFields(value, [
      "protocol",
      "kind",
      "deliveryId",
      "surfaceId",
      "channelName",
      "adapter",
    ]);
  }
  return (
    hasExactFields(value, [
      "protocol",
      "deliveryId",
      "canonicalThreadId",
      "surfaceId",
      "channelName",
      "adapter",
    ]) && isSafeExternalId(value.canonicalThreadId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
