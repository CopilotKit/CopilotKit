import { createHash, randomUUID } from "node:crypto";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import {
  CHANNEL_SESSION_PROTOCOL,
  assertProviderEffectEnvelopeSize,
  assertProviderEffect,
} from "./live-session-contracts.js";
import type { ChannelProviderEffect } from "./live-session-contracts.js";
import { LiveSessionFileClient } from "./live-session-files.js";
import type { ChannelFileRef } from "./live-session-files.js";
import { buildContentParts } from "./content-parts.js";
import { RealtimeGatewayPushError } from "./realtime-gateway.js";

const DELIVERY_EVENT = "channel.delivery.v1";
const EFFECT_EVENT = "channel.effect.v1";
const RUN_OPEN_EVENT = "channel.run.open.v1";
const RUN_CLOSE_EVENT = "channel.run.close.v1";
const COMPLETE_EVENT = "channel.delivery.complete.v1";
const FAIL_EVENT = "channel.delivery.fail.v1";
const HEARTBEAT_EVENT = "channel.session.heartbeat.v1";
const HEARTBEAT_INTERVAL_MS = 20_000;

export type LiveSessionAdapterKind = "slack" | "teams";

export type LiveSessionTurnInput =
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
      threadId?: string;
      postedRef?: string;
    }
  | {
      kind: "interaction";
      actionId: string;
      value?: unknown;
      /** Opaque Gateway-minted source-message capability; never a raw provider id. */
      messageRef?: { id: string };
      triggerId?: string;
    };

export interface LiveSessionDelivery {
  protocol: typeof CHANNEL_SESSION_PROTOCOL;
  deliveryId: string;
  /** Gateway-minted code required for the first delivery-topic join. */
  deliveryCode: string;
  sessionTopic: string;
  canonicalThreadId: string;
  appUserId: string;
  channelId: string;
  adapter: LiveSessionAdapterKind;
  turn: {
    id: string;
    eventId: string;
    receivedAt: string;
    input: LiveSessionTurnInput;
    actor?: {
      externalUserId: string;
      displayName?: string;
    };
  };
}

export interface LiveSessionRun {
  deliveryId: string;
  callId: string;
  responseId: string;
  threadId: string;
  runId: string;
  runnerToken: string;
  runnerTokenExpiresAt: string;
}

type ProviderEffectInput = ChannelProviderEffect extends infer Effect
  ? Effect extends ChannelProviderEffect
    ? Omit<Effect, "effectId" | "seq" | "responseId" | "payloadDigest">
    : never
  : never;

/** One admitted delivery topic and its ordered provider-effect cursor. */
export class LiveDeliverySession {
  private nextSeq = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(
    readonly delivery: LiveSessionDelivery,
    private readonly runtimeInstanceId: string,
    private readonly channel: RealtimeGatewayDeliveryChannel,
    private readonly files?: LiveSessionFileClient,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  ) {
    this.heartbeat = setInterval(() => {
      void this.channel
        .push(HEARTBEAT_EVENT, { protocol: CHANNEL_SESSION_PROTOCOL })
        .catch(() => undefined);
    }, heartbeatIntervalMs);
    this.heartbeat.unref?.();
  }

  /** Apply one destination-free provider effect in strict sequence order. */
  effect(
    responseId: string,
    body: ProviderEffectInput,
  ): Promise<{ receivedThrough: number; appliedThrough: number }> {
    const operation = this.tail.then(async () => {
      const seq = this.nextSeq;
      const unsigned = {
        ...body,
        effectId: `eff_${randomUUID().replaceAll("-", "")}`,
        seq,
        responseId,
      };
      const effect = {
        ...unsigned,
        payloadDigest: createHash("sha256")
          .update(JSON.stringify(unsigned))
          .digest("hex"),
      };
      assertProviderEffect(effect);
      const eventPayload = {
        occurredAt: new Date().toISOString(),
        payload: {
          protocol: CHANNEL_SESSION_PROTOCOL,
          deliveryId: this.delivery.deliveryId,
          runtimeInstanceId: this.runtimeInstanceId,
          effect,
        },
      };
      assertProviderEffectEnvelopeSize({
        type: EFFECT_EVENT,
        ...eventPayload,
      });
      const push = async (): Promise<{
        receivedThrough: number;
        appliedThrough: number;
      }> =>
        (await this.channel.push(EFFECT_EVENT, eventPayload)) as {
          receivedThrough: number;
          appliedThrough: number;
        };
      let result: { receivedThrough: number; appliedThrough: number };
      try {
        result = await push();
      } catch (error) {
        if (error instanceof RealtimeGatewayPushError) {
          throw error;
        }
        result = await push();
      }
      this.nextSeq += 1;
      return result;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  /** Open one standard AgentRunner invocation within this delivery. */
  openRun(args: {
    callId: string;
    responseId: string;
    agentId: string;
  }): Promise<LiveSessionRun> {
    return this.channel.push(RUN_OPEN_EVENT, {
      protocol: CHANNEL_SESSION_PROTOCOL,
      deliveryId: this.delivery.deliveryId,
      runtimeInstanceId: this.runtimeInstanceId,
      ...args,
    }) as Promise<LiveSessionRun>;
  }

  /** Close the active standard AgentRunner invocation. */
  async closeRun(callId: string, status: "complete" | "failed"): Promise<void> {
    await this.tail;
    await this.channel.push(RUN_CLOSE_EVENT, { callId, status });
  }

  /** Mark a handled delivery complete, including a direct-only handler. */
  async complete(): Promise<void> {
    await this.tail;
    await this.channel.push(COMPLETE_EVENT, {
      protocol: CHANNEL_SESSION_PROTOCOL,
    });
  }

  /** Settle a handler failure without waiting for owner-loss recovery. */
  async fail(reason: string): Promise<void> {
    await this.tail.catch(() => undefined);
    await this.channel.push(FAIL_EVENT, {
      protocol: CHANNEL_SESSION_PROTOCOL,
      reason: reason.slice(0, 512),
    });
  }

  /** Hydrate inbound file handles through app-api. */
  getContentParts(
    files: ChannelFileRef[] | undefined,
  ): Promise<AgentContentPart[]> {
    return buildContentParts(files, this.files?.fetchFile.bind(this.files));
  }

  /** Upload outbound bytes and return an opaque handle for a provider effect. */
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
    clearInterval(this.heartbeat);
    this.channel.leave();
  }
}

export interface LiveSessionTransportOptions {
  session: RealtimeGatewaySession;
  runtimeInstanceId: string;
  appApiBaseUrl?: string;
  apiKey?: string;
  fileFetch?: typeof fetch;
  /** SDK liveness heartbeat cadence; test seam, default 20 seconds. */
  heartbeatIntervalMs?: number;
  log?: (message: string, meta?: unknown) => void;
}

/**
 * Converts project-scoped delivery notices into concurrent delivery-scoped
 * sessions. Gateway admission remains the sole ownership election.
 */
export class LiveSessionTransport {
  private readonly active = new Map<string, Promise<void>>();
  private readonly files?: LiveSessionFileClient;
  private stopped = false;

  constructor(private readonly options: LiveSessionTransportOptions) {
    if (options.appApiBaseUrl && options.apiKey) {
      this.files = new LiveSessionFileClient({
        baseUrl: options.appApiBaseUrl,
        apiKey: options.apiKey,
        ...(options.fileFetch ? { fetch: options.fileFetch } : {}),
      });
    }
  }

  start(
    handler: (
      session: LiveDeliverySession,
      delivery: LiveSessionDelivery,
    ) => Promise<void>,
  ): void {
    this.options.session.on(DELIVERY_EVENT, (value) => {
      if (this.stopped || !isLiveSessionDelivery(value)) return;
      if (this.active.has(value.deliveryId)) return;
      const running = this.handleDelivery(value, handler).finally(() => {
        this.active.delete(value.deliveryId);
      });
      this.active.set(value.deliveryId, running);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled(this.active.values());
  }

  private async handleDelivery(
    delivery: LiveSessionDelivery,
    handler: (
      session: LiveDeliverySession,
      delivery: LiveSessionDelivery,
    ) => Promise<void>,
  ): Promise<void> {
    if (!this.options.session.join) {
      throw new Error(
        "Realtime Gateway session does not support delivery topics",
      );
    }
    let channel: RealtimeGatewayDeliveryChannel;
    try {
      channel = await this.options.session.join(delivery.sessionTopic, {
        protocol: CHANNEL_SESSION_PROTOCOL,
        runtimeInstanceId: this.options.runtimeInstanceId,
        deliveryCode: delivery.deliveryCode,
      });
    } catch (error) {
      this.options.log?.("channel delivery topic join failed", {
        deliveryId: delivery.deliveryId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const session = new LiveDeliverySession(
      delivery,
      this.options.runtimeInstanceId,
      channel,
      this.files,
      this.options.heartbeatIntervalMs,
    );
    try {
      await handler(session, delivery);
      await session.complete();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await session.fail(reason).catch((failError: unknown) => {
        this.options.log?.("channel delivery failure could not be recorded", {
          deliveryId: delivery.deliveryId,
          error:
            failError instanceof Error ? failError.message : String(failError),
        });
      });
      this.options.log?.("channel delivery handler failed", {
        deliveryId: delivery.deliveryId,
        error: reason,
      });
    } finally {
      session.leave();
    }
  }
}

function isLiveSessionDelivery(value: unknown): value is LiveSessionDelivery {
  if (typeof value !== "object" || value === null) return false;
  const delivery = value as Partial<LiveSessionDelivery>;
  return (
    delivery.protocol === CHANNEL_SESSION_PROTOCOL &&
    typeof delivery.deliveryId === "string" &&
    typeof delivery.deliveryCode === "string" &&
    delivery.deliveryCode.length > 0 &&
    typeof delivery.sessionTopic === "string" &&
    typeof delivery.canonicalThreadId === "string" &&
    typeof delivery.appUserId === "string" &&
    typeof delivery.channelId === "string" &&
    (delivery.adapter === "slack" || delivery.adapter === "teams") &&
    typeof delivery.turn === "object" &&
    delivery.turn !== null
  );
}
