import { randomUUID } from "node:crypto";
import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
  AgentMessage,
} from "./transports.js";
import type {
  ChannelIngressEnvelope,
  ChannelDeliveryScope,
  ChannelFileRef,
  EgressRoute,
  EgressOperation,
  EgressResult,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";
import type { MessageRef, AgentContentPart } from "@copilotkit/channels-ui";
import { irToText } from "./ir-to-text.js";
import { buildContentParts } from "./content-parts.js";

/**
 * @internal Default HTTP transports for {@link intelligenceAdapter}.
 *
 * These are the credentialed wire to a running Intelligence app-api: the
 * {@link HttpDeliverySource} polls the listener `claim` route and lease-fences
 * ack/fail; the {@link HttpEgressSink} posts replies to the egress route.
 * `intelligenceAdapter()` builds them by default (config from env), so a
 * consumer only writes `createBot({ adapters: [intelligenceAdapter()] })`.
 * Exported as undocumented fallbacks — the whole package is `@internal`.
 */

/** Minimal fetch shape (avoids DOM/Node lib coupling). Defaults to global `fetch`. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface IntelligenceTransportConfig {
  /** Intelligence app-api base URL, e.g. `http://localhost:7050`. */
  baseUrl: string;
  /** Project runtime API key (`cpk-…`), sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Project-unique channel name; defaults from `createBot({ name })`. */
  channelName: string;
  /** Stable runtime instance id (`rti_…`); generated when omitted. */
  runtimeInstanceId: string;
  /** Adapter kind. First slice is `"slack"`. */
  adapter: string;
  /** Injectable fetch (tests); defaults to global `fetch`. */
  fetch?: FetchLike;
  /** Heartbeat cadence / poll-sleep ceiling in ms (default 15000). */
  heartbeatIntervalMs?: number;
  /** Injectable sleep (tests); defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional logger for loop/transport diagnostics. */
  log?: (msg: string, meta?: unknown) => void;
  /**
   * Max wall-clock a single turn may take before the listener gives up on it,
   * `nack`s the delivery, and moves on (default 120000). Prevents a hung turn
   * (e.g. a HITL approval that never arrives, or a half-open stream) from
   * wedging the single-delivery-at-a-time loop indefinitely.
   */
  turnTimeoutMs?: number;
}

/**
 * Resolve transport config from explicit overrides then environment, failing
 * loudly if a required field is missing. Env: `COPILOTKIT_INTELLIGENCE_URL`,
 * `COPILOTKIT_API_KEY`, `COPILOTKIT_CHANNEL_NAME`,
 * `COPILOTKIT_RUNTIME_INSTANCE_ID`.
 */
export function resolveTransportConfig(
  overrides: Partial<IntelligenceTransportConfig> = {},
): IntelligenceTransportConfig {
  const env =
    typeof process !== "undefined"
      ? process.env
      : ({} as Record<string, string | undefined>);
  const baseUrl = (
    overrides.baseUrl ?? env["COPILOTKIT_INTELLIGENCE_URL"]
  )?.replace(/\/+$/, "");
  const apiKey = overrides.apiKey ?? env["COPILOTKIT_API_KEY"];
  const channelName = overrides.channelName ?? env["COPILOTKIT_CHANNEL_NAME"];
  const runtimeInstanceId =
    overrides.runtimeInstanceId ??
    env["COPILOTKIT_RUNTIME_INSTANCE_ID"] ??
    `rti_${randomUUID().replace(/-/g, "")}`;
  const adapter = overrides.adapter ?? "slack";

  const missing: string[] = [];
  if (!baseUrl) missing.push("baseUrl (COPILOTKIT_INTELLIGENCE_URL)");
  if (!apiKey) missing.push("apiKey (COPILOTKIT_API_KEY)");
  if (!channelName)
    missing.push("channelName (createBot({ name }) / COPILOTKIT_CHANNEL_NAME)");
  if (missing.length > 0) {
    throw new Error(
      `intelligenceAdapter: missing required transport config: ${missing.join(", ")}`,
    );
  }

  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    channelName: channelName!,
    runtimeInstanceId,
    adapter,
    fetch: overrides.fetch,
    heartbeatIntervalMs: overrides.heartbeatIntervalMs,
    sleep: overrides.sleep,
    log: overrides.log,
    turnTimeoutMs: overrides.turnTimeoutMs,
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Default per-turn deadline before a hung turn is nacked and skipped. */
const DEFAULT_TURN_TIMEOUT_MS = 120_000;

/**
 * Safety backstop on an inbound file download. app-api caps inbound files at
 * 25 MiB, so this generous ceiling never rejects legitimate traffic — it just
 * prevents an unbounded `arrayBuffer()` read if a served body is pathologically
 * large (anomaly / misrouted endpoint) and advertises its size.
 */
const MAX_INBOUND_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Reject after `ms` if `p` hasn't settled, so a hung turn can't wedge the
 * single-delivery loop. The underlying promise keeps running in the background
 * (harmless — a rejection handler is attached), but the loop moves on.
 */
function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Slack reply target Intelligence mints at ingress and the sink echoes back. */
interface SlackReplyTarget {
  adapter: "slack";
  teamId: string;
  channel: string;
  threadTs?: string;
}

/**
 * Teams reply target Intelligence mints at ingress (Bot Connector coordinates).
 * Distinct shape from Slack — no teamId/channel/threadTs — so conversation
 * identity must be derived per-provider (see {@link conversationKeyFromReplyTarget}).
 */
interface TeamsReplyTarget {
  adapter: "teams";
  serviceUrl: string;
  conversationId: string;
  tenantId: string;
}

/**
 * The claim's reply target is provider-tagged (Intelligence app-api mints a
 * discriminated union — one Channel runtime serves every channel its framework Bot has
 * attached now that claims are provider-agnostic).
 */
type ReplyTarget = SlackReplyTarget | TeamsReplyTarget;

/** Successful `claim` delivery envelope (subset the bridge reads). */
interface ClaimedDelivery {
  id: string;
  organizationId: string;
  projectId: number;
  channel: { id: string; name: string };
  adapter: string;
  leaseToken: string;
  turn: {
    id: string;
    eventId: string;
    replyTarget: ReplyTarget;
    // NB: there is intentionally no `thread_started` variant here — the claim
    // path only carries turn/command/reaction/interaction. `thread_started`
    // envelopes originate on the realtime gateway path, not from `claim`, so a
    // claimed delivery never maps to `kind:"thread_started"`.
    input?:
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
          /** SDK post-time ref the reacted message maps to (reverse-resolved by
           * app-api), so a `<Message onReaction>` handler can be found. */
          postedRef?: string;
        }
      | {
          kind: "interaction";
          /** Minted action id (ck:...) the clicked control carried. */
          actionId: string;
          /** The clicked control's value (block_actions value / selected options). */
          value?: unknown;
          /** The message the interaction occurred on (so a handler can update it). */
          messageRef?: MessageRef;
          /** Slack trigger id (for opening a modal off the interaction). */
          triggerId?: string;
        };
  };
}

/** Per-delivery org/project/channel scope, echoed onto render frames. */
type ClaimResponse =
  | { claimed: false; pollAfterMs: number }
  | { claimed: true; delivery: ClaimedDelivery };

interface EgressResponse {
  operationId: string;
  status: "accepted" | "duplicate" | "sent" | "failed";
  error?: { code: string; message: string; retryable: boolean };
}

/** A `cpk-`-authenticated JSON POST helper against Intelligence app-api. */
class IntelligenceHttp {
  constructor(private readonly cfg: IntelligenceTransportConfig) {}

  private fetchImpl(): FetchLike {
    const f =
      this.cfg.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error(
        "intelligenceAdapter: no fetch available — provide config.fetch or run on Node 18+",
      );
    }
    return f;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl()(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(
        `intelligence ${path} -> ${res.status}: ${raw.slice(0, 300)}`,
      );
    }
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  }
}

/**
 * Stable per-conversation key, derived per provider — it keys the agent/session
 * (`getOrCreate(conversationKey)`), so distinct conversations MUST get distinct
 * keys or their state bleeds together. Slack: `slack:teamId:channel:thread:threadTs`.
 * Teams: `teams:tenantId:conversationId`, matching app-api's `thread_key`
 * (`teams:{tenantId}:{conversationId}`) so client and server agree on identity.
 * Deriving from Slack-only fields would collapse every Teams conversation to one
 * key — the bug this switch prevents now that claims are provider-agnostic.
 */
function conversationKeyFromReplyTarget(rt: ReplyTarget): string {
  switch (rt.adapter) {
    case "slack":
      return `slack:${rt.teamId}:${rt.channel}:thread:${rt.threadTs ?? "root"}`;
    case "teams":
      return `teams:${rt.tenantId}:${rt.conversationId}`;
    default: {
      // A provider we don't model yet: fail loud rather than silently collide
      // distinct conversations onto a shared agent/session.
      const unknown = rt as { adapter?: string };
      throw new Error(
        `conversationKeyFromReplyTarget: unsupported reply-target adapter ${JSON.stringify(unknown.adapter)}`,
      );
    }
  }
}

function mapDeliveryToEnvelope(d: ClaimedDelivery): ChannelIngressEnvelope {
  const base = {
    deliveryId: d.id,
    eventId: d.turn.eventId,
    turnId: d.turn.id,
    // `ChannelIngressEnvelope` remains aligned with the channels framework's
    // Bot object; only the Intelligence HTTP wire contract calls this a channel.
    channelName: d.channel.name,
    platform: d.adapter,
    conversationKey: conversationKeyFromReplyTarget(d.turn.replyTarget),
    route: d.turn.replyTarget,
  };
  const input = d.turn.input;

  if (input?.kind === "command") {
    return {
      ...base,
      kind: "command",
      command: input.command,
      text: input.text ?? "",
      ...(input.triggerId ? { triggerId: input.triggerId } : {}),
      ...(input.rawOptions ? { rawOptions: input.rawOptions } : {}),
    };
  }

  if (input?.kind === "reaction") {
    return {
      ...base,
      kind: "reaction",
      rawEmoji: input.rawEmoji,
      added: input.added,
      messageId: input.messageId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.postedRef ? { postedRef: input.postedRef } : {}),
    };
  }

  if (input?.kind === "interaction") {
    return {
      ...base,
      kind: "interaction",
      actionId: input.actionId,
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.messageRef ? { messageRef: input.messageRef } : {}),
      ...(input.triggerId ? { triggerId: input.triggerId } : {}),
    };
  }

  if (input === undefined || input.kind === "text") {
    return {
      ...base,
      kind: "turn",
      text: input?.text ?? "",
      ...(input?.files?.length ? { files: input.files } : {}),
    };
  }

  // Exhaustiveness guard: mirror the adapter's dispatch switch — an unknown wire
  // kind must fail loud rather than be silently coerced into an empty turn (which
  // would then ack as a processed no-op).
  const unhandled: never = input;
  throw new Error(
    `intelligenceAdapter: unknown delivery input kind ${JSON.stringify(unhandled)}`,
  );
}

interface LeaseRecord {
  turnId: string;
  leaseToken: string;
  scope: ChannelDeliveryScope;
}

/**
 * @internal {@link DeliverySource} that polls Intelligence's runtime listener
 * routes (heartbeat + claim) and lease-fences ack/fail. One delivery is
 * processed at a time: the claim loop awaits `onDelivery` (which the adapter
 * resolves only after it has called back into `ack`/`nack`).
 */
export class HttpDeliverySource implements DeliverySource {
  private readonly http: IntelligenceHttp;
  private readonly leases = new Map<string, LeaseRecord>();
  private running = false;
  private loop?: Promise<void>;
  private lastHeartbeatAt = 0;

  constructor(private readonly cfg: IntelligenceTransportConfig) {
    this.http = new IntelligenceHttp(cfg);
  }

  private sleep(ms: number): Promise<void> {
    return (this.cfg.sleep ?? defaultSleep)(ms);
  }

  /** Declare this runtime + channel to Intelligence and keep the activation fresh. */
  async heartbeat(): Promise<void> {
    await this.http.post("/api/channels/listener/heartbeat", {
      runtimeInstanceId: this.cfg.runtimeInstanceId,
      declaredChannels: [
        { channelName: this.cfg.channelName, adapter: this.cfg.adapter },
      ],
      observedAt: new Date().toISOString(),
    });
    this.lastHeartbeatAt = Date.now();
  }

  /** Claim a single delivery; returns the mapped envelope, or the idle backoff. */
  async claimOnce(): Promise<
    { env: ChannelIngressEnvelope } | { pollAfterMs: number }
  > {
    const res = await this.http.post<ClaimResponse>(
      "/api/channels/listener/claim",
      {
        // Claim provider-agnostically: the Channel runtime emits abstract render
        // frames and Intelligence renders per the delivery's own reply target, so
        // a single runtime serves every channel its bot has attached (Slack,
        // Teams, ...). Declaring a single adapter here made Intelligence withhold
        // deliveries for the bot's other channels (e.g. a Slack-declared runtime
        // never received the same bot's Teams messages).
        runtimeInstanceId: this.cfg.runtimeInstanceId,
      },
    );
    if (!res.claimed) return { pollAfterMs: res.pollAfterMs ?? 1000 };
    this.leases.set(res.delivery.id, {
      turnId: res.delivery.turn.id,
      leaseToken: res.delivery.leaseToken,
      scope: {
        organizationId: res.delivery.organizationId,
        projectId: res.delivery.projectId,
        channelId: res.delivery.channel.id,
        channelName: res.delivery.channel.name,
      },
    });
    try {
      return { env: mapDeliveryToEnvelope(res.delivery) };
    } catch (mapErr) {
      // An unmappable/unknown delivery kind must fail loud, but must not wedge
      // the single-delivery loop: the lease is already recorded, so nack it
      // here (non-retryable — re-mapping the same payload fails identically, so
      // let app-api dead-letter it rather than burn retries) and fall through to
      // an idle poll so the loop keeps draining the queue. Without this the
      // throw escapes to runLoop's catch, which only logs+sleeps, leaking the
      // lease until the 120s expiry redelivers the same poison payload forever.
      this.cfg.log?.("intelligence claim: unmappable delivery", mapErr);
      await this.nack(
        res.delivery.id,
        mapErr instanceof Error ? mapErr.message : String(mapErr),
        false,
      ).catch((nackErr) =>
        this.cfg.log?.(
          "intelligence nack after unmappable delivery failed",
          nackErr,
        ),
      );
      return { pollAfterMs: 1000 };
    }
  }

  /** The org/project/channel scope for a leased delivery, for render-frame egress. */
  scopeFor(deliveryId: string): ChannelDeliveryScope | undefined {
    return this.leases.get(deliveryId)?.scope;
  }

  /** The lease token for a leased delivery, so a render frame can fence its
   * accept against `lease_token_hash` the same way ack/fail already do. */
  leaseTokenFor(deliveryId: string): string | undefined {
    return this.leases.get(deliveryId)?.leaseToken;
  }

  async start(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.running = true;
    await this.heartbeat();
    this.loop = this.runLoop(onDelivery);
  }

  private async runLoop(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    const cadence = this.cfg.heartbeatIntervalMs ?? 15000;
    while (this.running) {
      try {
        if (Date.now() - this.lastHeartbeatAt >= cadence)
          await this.heartbeat();
        const r = await this.claimOnce();
        if ("env" in r) {
          // The adapter dispatches the turn and calls back into ack/nack
          // before this resolves — at-least-once, one delivery at a time.
          // Bound it: a turn that throws or hangs must not wedge the loop, so
          // we time it out, `nack` to release the lease immediately (app-api
          // then retries / dead-letters at max_attempts), and keep polling.
          const env = r.env;
          const timeoutMs = this.cfg.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
          try {
            await withTimeout(
              onDelivery(env),
              timeoutMs,
              `turn ${env.turnId} exceeded ${timeoutMs}ms`,
            );
          } catch (turnErr) {
            this.cfg.log?.("intelligence turn failed/timed out", turnErr);
            await this.nack(
              env.deliveryId,
              turnErr instanceof Error ? turnErr.message : String(turnErr),
            ).catch((nackErr) =>
              this.cfg.log?.(
                "intelligence nack after turn failure failed",
                nackErr,
              ),
            );
          }
        } else {
          await this.sleep(Math.min(r.pollAfterMs || 1000, cadence));
        }
      } catch (err) {
        this.cfg.log?.("intelligence listener loop error", err);
        await this.sleep(2000);
      }
    }
  }

  async ack(deliveryId: string): Promise<void> {
    const lease = this.leases.get(deliveryId);
    if (!lease) {
      this.cfg.log?.(`intelligence ack: no lease for delivery ${deliveryId}`);
      return;
    }
    // Claim the terminal signal BEFORE the wire call. A turn that completes in
    // the background after a timeout-`nack` (both close over this lease) must
    // not also ack: whichever of ack/nack runs first deletes the lease, so the
    // other sees none and no-ops — exactly one of ack XOR fail reaches app-api.
    this.leases.delete(deliveryId);
    await this.http.post(
      `/api/channels/deliveries/${encodeURIComponent(deliveryId)}/ack`,
      {
        turnId: lease.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        leaseToken: lease.leaseToken,
        acknowledgedAt: new Date().toISOString(),
      },
    );
  }

  async nack(
    deliveryId: string,
    reason: string,
    retryable = true,
  ): Promise<void> {
    const lease = this.leases.get(deliveryId);
    if (!lease) {
      this.cfg.log?.(`intelligence nack: no lease for delivery ${deliveryId}`);
      return;
    }
    // Delete-before-POST for the same reason as `ack`: single terminal signal.
    this.leases.delete(deliveryId);
    await this.http.post(
      `/api/channels/deliveries/${encodeURIComponent(deliveryId)}/fail`,
      {
        turnId: lease.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        leaseToken: lease.leaseToken,
        failedAt: new Date().toISOString(),
        error: {
          code: "runtime_error",
          message: (reason || "runtime error").slice(0, 500),
          retryable,
        },
      },
    );
  }

  /**
   * Download an inbound file's raw bytes by handle from app-api's file-serve
   * route. Bypasses {@link IntelligenceHttp} on purpose — that helper is
   * JSON/POST-only and decodes bodies as text, which corrupts binary; the
   * global `fetch` gives us `arrayBuffer()`. Auth is the same runtime bearer.
   */
  async fetchFile(
    handle: string,
  ): Promise<{ bytes: Uint8Array; mimeType?: string }> {
    const gfetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
    if (!gfetch) {
      throw new Error(
        "intelligenceAdapter: no global fetch available for file download",
      );
    }
    const url = `${this.cfg.baseUrl}/api/channels/files/${encodeURIComponent(handle)}`;
    const res = await gfetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${this.cfg.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`intelligence file ${handle} -> ${res.status}`);
    }
    // Bound the body read when the server advertises an oversize length, before
    // pulling the whole thing into memory as an arrayBuffer.
    const declaredLen = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLen) && declaredLen > MAX_INBOUND_FILE_BYTES) {
      throw new Error(
        `intelligence file ${handle} too large: ${declaredLen} bytes > ${MAX_INBOUND_FILE_BYTES} cap`,
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? undefined;
    return { bytes, mimeType };
  }

  /**
   * Fetch prior thread turns from app-api's channel history route for
   * conversation-history seeding (parity with bot-slack/bot-discord/
   * bot-whatsapp's reconstructed-history conversation stores). A root-level
   * turn (no `threadTs`) has no prior thread to look up, so this returns `[]`
   * without a request. Best-effort like {@link fetchFile}'s sibling paths — any
   * non-2xx response or thrown error degrades to `[]`; missing history must
   * never fail the turn. Logging is split by failure class: a 4xx (except
   * 429) is a permanent misconfiguration (route not mounted / wrong baseUrl /
   * bad runtime key) and is logged loudly and distinctly so it doesn't hide
   * forever; a 5xx, 429, or thrown network error is a transient blip and gets
   * the existing quiet degradation log.
   */
  async getHistory(
    replyTarget: EgressRoute,
    limit: number,
  ): Promise<AgentMessage[]> {
    // Provider-specific history query. `EgressRoute` is opaque, so each adapter
    // maps its route → app-api's `/api/channels/history` query here, mirroring
    // `conversationKeyFromReplyTarget`'s per-adapter switch. Slack keys off
    // `threadTs`; Teams off `tenantId`+`conversationId` (matching app-api's
    // `teams:{tenantId}:{conversationId}` thread_key). A turn with no thread
    // anchor has no prior history to look up, so return `[]`.
    const rt = replyTarget as
      | {
          adapter?: string;
          teamId?: string;
          channel?: string;
          threadTs?: string;
          tenantId?: string;
          conversationId?: string;
        }
      | undefined;
    let qs: URLSearchParams;
    if (rt?.adapter === "teams") {
      if (!rt.tenantId || !rt.conversationId) return [];
      qs = new URLSearchParams({
        adapter: "teams",
        tenantId: rt.tenantId,
        conversationId: rt.conversationId,
        limit: String(limit),
      });
    } else {
      if (!rt?.threadTs) return [];
      qs = new URLSearchParams({
        teamId: rt.teamId ?? "",
        channel: rt.channel ?? "",
        threadTs: rt.threadTs,
        limit: String(limit),
      });
    }
    try {
      const gfetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
      if (!gfetch) {
        this.cfg.log?.("intelligence history fetch: no global fetch available");
        return [];
      }
      const url = `${this.cfg.baseUrl}/api/channels/history?${qs.toString()}`;
      const res = await gfetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${this.cfg.apiKey}` },
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // A permanent misconfiguration (missing route, wrong baseUrl, bad
          // runtime key) looks identical to a transient blip unless it's
          // called out distinctly — surface it loudly so it doesn't hide
          // forever behind the best-effort degrade-to-`[]` below.
          this.cfg.log?.(
            `[intelligence] getHistory ${res.status} for thread history — likely a misconfigured/unauthorized history endpoint (baseUrl/route/apiKey); Channel Bot will run WITHOUT prior-turn history`,
          );
        } else {
          // Transient (5xx/429) — quiet best-effort degradation, history is
          // just skipped for this turn.
          this.cfg.log?.(`intelligence history fetch -> ${res.status}`);
        }
        return [];
      }
      const json = (await res.json()) as {
        messages?: Array<{
          id: string;
          role: "user" | "assistant";
          text: string;
          files?: ChannelFileRef[];
        }>;
      };
      const out: AgentMessage[] = [];
      for (const m of json.messages ?? []) {
        if (!m.files?.length) {
          out.push({ id: m.id, role: m.role, content: m.text ?? "" });
          continue;
        }
        // Hydrate historical file refs with the SAME logic as the live inbound
        // turn path, so a past image attachment and a live one produce
        // identical content parts (e.g. "what was the image I sent?" works).
        const fileParts = await buildContentParts(
          m.files,
          this.fetchFile.bind(this),
          this.cfg.log,
        );
        const content: AgentContentPart[] = [];
        if (m.text) content.push({ type: "text", text: m.text });
        content.push(...fileParts);
        out.push({ id: m.id, role: m.role, content });
      }
      // Defensive parity with InMemoryDeliverySource.getHistory (`slice(-limit)`):
      // the route contract is oldest→newest capped at `limit`, but don't trust
      // the server to honor it — keep the most recent `limit` so an over-
      // returning route can't seed more than `historyLimit` onto agent.messages.
      return out.length > limit ? out.slice(-limit) : out;
    } catch (err) {
      this.cfg.log?.("intelligence history fetch failed", err);
      return [];
    }
  }

  /**
   * Stream an outbound file's bytes to app-api's per-delivery upload route
   * (lease-scoped) ahead of a `file` render frame. Returns the storage handle
   * the frame references. Bytes go as the raw request body; display metadata
   * rides query params.
   */
  async uploadFile(
    deliveryId: string,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ handle: string }> {
    const gfetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
    if (!gfetch) {
      throw new Error(
        "intelligenceAdapter: no global fetch available for file upload",
      );
    }
    const qs = new URLSearchParams({ filename: args.filename });
    if (args.title) qs.set("title", args.title);
    if (args.altText) qs.set("altText", args.altText);
    const url = `${this.cfg.baseUrl}/api/channels/deliveries/${encodeURIComponent(
      deliveryId,
    )}/files?${qs.toString()}`;
    const res = await gfetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        "content-type": "application/octet-stream",
      },
      // The runtime (undici) sends the Uint8Array bytes verbatim; the static
      // `fetch` body type differs across this package's dom vs node-only lib
      // configs, so bridge with a portable cast (`string` is a valid body in
      // both). The value is never actually a string at runtime.
      body: args.bytes as unknown as string,
    });
    if (!res.ok) {
      throw new Error(`intelligence file upload -> ${res.status}`);
    }
    const json = (await res.json()) as { handle?: string };
    if (!json.handle) {
      throw new Error("intelligence file upload: response missing handle");
    }
    return { handle: json.handle };
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop?.catch(() => {});
  }
}

/**
 * @internal {@link EgressSink} that posts replies to Intelligence's egress
 * route. IR is flattened to plain text (first slice — Intelligence renders
 * natively later); the egress operation id is the idempotency key so SDK
 * redeliveries dedupe at Intelligence.
 */
export class HttpEgressSink implements EgressSink {
  private readonly http: IntelligenceHttp;

  constructor(private readonly cfg: IntelligenceTransportConfig) {
    this.http = new IntelligenceHttp(cfg);
  }

  async emit(op: EgressOperation): Promise<EgressResult> {
    // First slice: Intelligence egress is post-only. A delete has no remote
    // message to remove; ack it as a no-op so the run isn't treated as failed.
    if (op.op.kind === "delete") return { ok: true, ref: op.operationId };

    const text = irToText(op.op.ir);
    // Intelligence requires non-empty text; skip empties without a 400.
    if (!text) return { ok: true, ref: op.operationId };

    try {
      const res = await this.http.post<EgressResponse>(
        "/api/channels/egress/messages",
        {
          channelName: this.cfg.channelName,
          adapter: this.cfg.adapter,
          deliveryId: op.deliveryId,
          idempotencyKey: op.operationId,
          replyTarget: op.route,
          text,
        },
      );
      if (res.status === "failed") {
        return { ok: false, code: res.error?.code ?? "failed" };
      }
      return { ok: true, ref: res.operationId };
    } catch (err) {
      return {
        ok: false,
        code: err instanceof Error ? err.message : "egress_error",
      };
    }
  }
}

/** Durable render-acceptance receipt (subset the sink reads). */
interface RenderAcceptedResponse {
  idempotencyKey?: string;
  acceptance?: RenderAccepted["acceptance"];
  egressOperationId?: string;
}

/**
 * @internal {@link RenderEventSink} that streams semantic render frames to
 * Intelligence's durable render-acceptance route
 * (`/api/channels/deliveries/:id/render-events/accept`). This is the HTTP-path
 * equivalent of the realtime {@link RealtimeGatewayTransport}: each frame is
 * POSTed and the durable acceptance receipt is awaited before the next. The
 * gateway-side Connector Outbox then renders the accepted frames to Slack, so
 * this path reaches full reply-UX parity without a running realtime gateway.
 *
 * Per-delivery org/project/channel scope is read from the {@link HttpDeliverySource}
 * that leased the delivery (populated at claim). The `deliveryId` travels in the
 * URL only — the accept route rejects a body that also carries it.
 */
export class HttpRenderEventSink implements RenderEventSink {
  private readonly http: IntelligenceHttp;

  constructor(
    private readonly cfg: IntelligenceTransportConfig,
    private readonly scopeSource: {
      scopeFor(deliveryId: string): ChannelDeliveryScope | undefined;
      leaseTokenFor(deliveryId: string): string | undefined;
    },
  ) {
    this.http = new IntelligenceHttp(cfg);
  }

  async push(frame: RenderFrame): Promise<RenderAccepted> {
    const scope = this.scopeSource.scopeFor(frame.deliveryId);
    if (!scope) {
      throw new Error(
        `intelligenceAdapter: no leased scope for delivery ${frame.deliveryId}`,
      );
    }
    // Fence the render-accept on the delivery's lease token (OSS-446), the same
    // way ack/fail already do. Optional: app-api falls back to instance-id +
    // expiry when it's absent, so an older lease record without a token still
    // renders — but supplying it lets app-api reject a stale/rotated lease.
    const leaseToken = this.scopeSource.leaseTokenFor(frame.deliveryId);
    const idempotencyKey = `${frame.turnId}:${frame.slot}:${frame.seq}`;
    const res = await this.http.post<RenderAcceptedResponse>(
      `/api/channels/deliveries/${encodeURIComponent(frame.deliveryId)}/render-events/accept`,
      {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        channelId: scope.channelId,
        channelName: scope.channelName,
        turnId: frame.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        slot: frame.slot,
        seq: frame.seq,
        idempotencyKey,
        event: frame.event,
        ...(leaseToken ? { leaseToken } : {}),
        sentAt: new Date().toISOString(),
      },
    );
    return {
      idempotencyKey: res.idempotencyKey ?? idempotencyKey,
      acceptance: res.acceptance ?? "accepted",
      ...(res.egressOperationId
        ? { egressOperationId: res.egressOperationId }
        : {}),
    };
  }
}
