import { contentToText } from "@ag-ui/core";
import type { Message, RunAgentInput } from "@ag-ui/core";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import type {
  IncomingTurn,
  IngressIdentityContext,
  InteractionEvent,
} from "@copilotkit/channels-core";
import type { ProviderActor } from "@copilotkit/channels-ui";
import type { WebReplyTarget, WebUser } from "./types.js";
import { CHANNEL_INTERACTION_KEY } from "./wire.js";
import type { ChannelInteraction } from "./wire.js";

export const WEB_PLATFORM = "web";

/** A validated run request, classified by what it asks the Channel to do. */
export type ParsedRunRequest =
  | { kind: "turn"; input: RunAgentInput; message: Message & { role: "user" } }
  | {
      kind: "interaction";
      input: RunAgentInput;
      interaction: ChannelInteraction;
    };

export type ParseResult =
  | { ok: true; request: ParsedRunRequest }
  | { ok: false; error: string };

function readInteraction(
  value: unknown,
): ChannelInteraction | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return "invalid";
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return "invalid";
  if (raw.messageId !== undefined && typeof raw.messageId !== "string") {
    return "invalid";
  }
  if (
    raw.values !== undefined &&
    (typeof raw.values !== "object" ||
      raw.values === null ||
      Array.isArray(raw.values))
  ) {
    return "invalid";
  }
  return {
    id: raw.id,
    ...("value" in raw ? { value: raw.value } : {}),
    ...(raw.values !== undefined
      ? { values: raw.values as Record<string, unknown> }
      : {}),
    ...(raw.messageId !== undefined ? { messageId: raw.messageId } : {}),
  };
}

/**
 * Validate an AG-UI `RunAgentInput` body and decide what it asks for.
 *
 * - `forwardedProps.channelInteraction` present → a control click.
 * - Otherwise → a turn for the newest user message in `messages`.
 */
export function parseRunRequest(body: unknown): ParseResult {
  const parsed = RunAgentInputSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "body is not a valid AG-UI RunAgentInput" };
  }
  const input = parsed.data as RunAgentInput;
  const forwarded =
    typeof input.forwardedProps === "object" && input.forwardedProps !== null
      ? (input.forwardedProps as Record<string, unknown>)
      : {};
  const interaction = readInteraction(forwarded[CHANNEL_INTERACTION_KEY]);
  if (interaction === "invalid") {
    return {
      ok: false,
      error: `forwardedProps.${CHANNEL_INTERACTION_KEY} must be { id: string, value?, values?: object, messageId?: string }`,
    };
  }
  if (interaction) {
    return { ok: true, request: { kind: "interaction", input, interaction } };
  }
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i]!;
    if (message.role === "user") {
      return {
        ok: true,
        request: {
          kind: "turn",
          input,
          message: message as Message & { role: "user" },
        },
      };
    }
  }
  return { ok: false, error: "messages has no user message to answer" };
}

/** The actor for a request: the resolved user, or one anonymous actor per conversation. */
export function actorFor(
  user: WebUser | null | undefined,
  threadId: string,
): ProviderActor {
  if (user) {
    return {
      id: user.id,
      kind: "human",
      ...(user.name ? { name: user.name } : {}),
      ...(user.email ? { email: user.email } : {}),
    };
  }
  return { id: `anonymous:${threadId}`, kind: "unknown" };
}

function identityContext(
  input: RunAgentInput,
  trigger: "message" | "interaction",
  eventId: string,
): IngressIdentityContext {
  return {
    tenant: { id: WEB_PLATFORM },
    installation: { id: WEB_PLATFORM },
    conversation: { id: input.threadId, kind: "direct" },
    trigger,
    event: { id: eventId, occurredAt: new Date().toISOString() },
    raw: input,
  };
}

export function replyTargetFor(input: RunAgentInput): WebReplyTarget {
  return {
    threadId: input.threadId,
    runId: input.runId,
    messages: input.messages,
  };
}

/** Build the `onTurn` event for a turn request. */
export function buildTurn(
  request: Extract<ParsedRunRequest, { kind: "turn" }>,
  actor: ProviderActor,
): IncomingTurn {
  const { input, message } = request;
  return {
    conversationKey: input.threadId,
    replyTarget: replyTargetFor(input),
    actor,
    identityContext: identityContext(input, "message", message.id),
    userText: contentToText(message.content as never),
    operation: {
      kind: "created",
      logicalMessageId: message.id,
      // Each HTTP request is an explicit ask to run, so the revision is the
      // run id: a replay of the same request is deduplicated, a new run for
      // the same message (a retry) is not.
      revisionId: input.runId,
      // Every web message is addressed to the bot.
      mentioned: true,
    },
    platform: WEB_PLATFORM,
  };
}

/** Build the `onInteraction` event for a click request. */
export function buildInteraction(
  request: Extract<ParsedRunRequest, { kind: "interaction" }>,
  actor: ProviderActor,
): InteractionEvent {
  const { input, interaction } = request;
  const value = interaction.value;
  const rawValue =
    typeof value === "string" ||
    (Array.isArray(value) && value.every((v) => typeof v === "string"))
      ? (value as string | string[])
      : undefined;
  return {
    id: interaction.id,
    conversationKey: input.threadId,
    replyTarget: replyTargetFor(input),
    actor,
    identityContext: identityContext(input, "interaction", input.runId),
    eventId: input.runId,
    ...("value" in interaction ? { value } : {}),
    ...(rawValue !== undefined ? { rawValue } : {}),
    ...(interaction.values ? { values: interaction.values } : {}),
    ...(interaction.messageId
      ? { messageRef: { id: interaction.messageId, threadId: input.threadId } }
      : {}),
  };
}
