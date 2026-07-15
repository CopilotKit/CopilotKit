import type { MessageRef } from "@copilotkit/channels-ui";
import type { ChannelFileRef, ChannelIngressEnvelope } from "./contracts.js";

/**
 * Shared claim → ingress-envelope mapping used by BOTH transports (the HTTP
 * polling {@link ../http-transports} and the realtime gateway
 * {@link ../realtime-gateway-transport}). Extracted so the two paths cannot
 * drift — divergence here is exactly what OSS-476 fixes: the realtime path had
 * a text-only mapping that coerced commands/reactions/interactions into empty
 * turns, keyed conversations per-turn (breaking threaded follow-ups), and
 * dropped the provider actor identity.
 */

/** Slack reply target Intelligence mints at ingress. */
export interface SlackReplyTarget {
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
export interface TeamsReplyTarget {
  adapter: "teams";
  serviceUrl: string;
  conversationId: string;
  tenantId: string;
}

/**
 * The claim's reply target is provider-tagged (Intelligence app-api mints a
 * discriminated union — one Channel runtime serves every channel its framework
 * Bot has attached now that claims are provider-agnostic).
 */
export type ReplyTarget = SlackReplyTarget | TeamsReplyTarget;

/**
 * The provider user who authored the turn, carried on the claim (OSS-476). It
 * is opaque runtime identity — NOT a control-plane user — and maps to the
 * ingress envelope's {@link ChannelIngressBase.user}.
 */
export interface ClaimedDeliveryActor {
  externalUserId: string;
  displayName?: string;
}

/** Successful `claim` delivery envelope (the subset the bridge reads). */
export interface ClaimedDelivery {
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
    /** Provider identity of the turn's author (OSS-476). */
    actor?: ClaimedDeliveryActor;
    // NB: there is intentionally no `thread_started` variant here — the claim
    // path only carries turn/command/reaction/interaction. Neither wire mapper
    // produces `kind:"thread_started"`: BOTH the HTTP and realtime transports
    // build their envelope through this same `mapDeliveryToEnvelope`, so a real
    // `thread_started` delivery over either transport would fall through to the
    // empty-`turn` default below, not the `onThreadStarted` dispatch branch.
    // Today `kind:"thread_started"` is only produced by an injected in-memory
    // source (tests); wiring it over a real transport needs a dedicated mapper
    // path (follow-up), not this claim shape.
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

/**
 * Stable per-conversation key, derived per provider — it keys the agent/session
 * (`getOrCreate(conversationKey)`), so distinct conversations MUST get distinct
 * keys or their state bleeds together. Slack: `slack:teamId:channel:thread:threadTs`.
 * Teams: `teams:tenantId:conversationId`, matching app-api's `thread_key`
 * (`teams:{tenantId}:{conversationId}`) so client and server agree on identity.
 * Deriving from Slack-only fields would collapse every Teams conversation to one
 * key — the bug this switch prevents now that claims are provider-agnostic.
 */
export function conversationKeyFromReplyTarget(rt: ReplyTarget): string {
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

/**
 * Map a claimed delivery to the discriminated {@link ChannelIngressEnvelope} the
 * bridge adapter routes on. Threads the provider `actor` through as
 * `env.user`, derives a thread-stable `conversationKey`, and discriminates on
 * `input.kind` — an unknown kind fails loud rather than being silently coerced
 * into an empty turn (which would then ack as a processed no-op).
 */
export function mapDeliveryToEnvelope(
  d: ClaimedDelivery,
): ChannelIngressEnvelope {
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
    // Provider identity → opaque runtime app user (OSS-476). Omitted when the
    // claim carries no actor (older gateway/app-api, or an actor-less event).
    ...(d.turn.actor
      ? {
          user: {
            id: d.turn.actor.externalUserId,
            ...(d.turn.actor.displayName
              ? { displayName: d.turn.actor.displayName }
              : {}),
          },
        }
      : {}),
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
