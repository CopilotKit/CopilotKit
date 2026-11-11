import type { InteractionEvent } from "@copilotkit/channels-core";
import type { IngressIdentityContext } from "@copilotkit/channels-core";
import type { ProviderActor } from "@copilotkit/channels-ui";
import { isDirectMessage, normalizeEvent } from "./events.js";
import type { ChatSpace, ChatUser, NormalizedEvent } from "./events.js";
import { conversationKeyOf } from "./types.js";
import type { GoogleChatMessageRef, ReplyTarget } from "./types.js";

/** Parameter keys the card renderer writes onto every action. */
export const ACTION_ID_PARAM = "actionId";
export const VALUE_PARAM = "value";

/** Where a reply to a message in `space` (on `threadName`) belongs. */
export function replyTargetOf(
  space: ChatSpace,
  threadName: string | undefined,
): ReplyTarget {
  const name = space.name ?? "";
  if (isDirectMessage(space) || !threadName) return { space: name };
  return { space: name, thread: threadName };
}

/** A Google Chat user as a provider actor. */
export function actorOf(user: ChatUser | undefined): ProviderActor {
  const kind: ProviderActor["kind"] =
    user?.type === "HUMAN" ? "human" : user?.type === "BOT" ? "bot" : "unknown";
  return {
    id: user?.name ?? "",
    kind,
    ...(user?.displayName ? { name: user.displayName } : {}),
    ...(user?.email ? { email: user.email } : {}),
  };
}

/** Identity facts for the channel's `identifyUser` strategy. */
export function identityContextOf(
  evt: NormalizedEvent,
  conversationKey: string,
  trigger: string,
  eventId: string | undefined,
): IngressIdentityContext {
  const space = evt.space?.name ?? "";
  return {
    tenant: { id: space },
    installation: { id: space },
    conversation: {
      id: conversationKey,
      kind: isDirectMessage(evt.space) ? "direct" : "space",
    },
    trigger,
    event: {
      ...(eventId ? { id: eventId } : {}),
      ...(evt.eventTime ? { occurredAt: evt.eventTime } : {}),
    },
    raw: evt,
  };
}

/** Parse a parameter the renderer JSON-encoded; fall back to the raw string. */
function parseValue(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Decode a card click (either envelope) into an `InteractionEvent`.
 *
 * The renderer puts the minted action id in the `actionId` parameter, because
 * an add-on Chat app's `function` must be the endpoint URL. Legacy apps also
 * carry it as the function name, so `invokedFunction` is the fallback.
 *
 * A dropdown sends no `value` parameter: its choice is the form input named
 * after the action id.
 */
export function decodeInteraction(raw: unknown): InteractionEvent | undefined {
  const evt = isNormalized(raw) ? raw : normalizeEvent(raw);
  if (evt.kind !== "click" || !evt.space?.name) return undefined;
  const id = evt.parameters[ACTION_ID_PARAM] ?? evt.invokedFunction;
  if (!id) return undefined;

  const replyTarget = replyTargetOf(evt.space, evt.message?.thread?.name);
  const conversationKey = conversationKeyOf(
    replyTarget.space,
    replyTarget.thread,
  );

  let value: unknown;
  let rawValue: string | string[] | undefined;
  const selected = evt.formInputs?.[id]?.stringInputs?.value;
  if (VALUE_PARAM in evt.parameters) {
    rawValue = evt.parameters[VALUE_PARAM];
    value = parseValue(rawValue);
  } else if (selected) {
    rawValue = evt.parameters.multi === "true" ? selected : selected[0];
    value = rawValue;
  }

  const values: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(evt.formInputs ?? {})) {
    const v = input.stringInputs?.value;
    if (v) values[name] = v.length === 1 ? v[0] : v;
  }

  const messageName = evt.message?.name;
  const messageRef: GoogleChatMessageRef | undefined = messageName
    ? {
        id: messageName,
        space: replyTarget.space,
        ...(replyTarget.thread ? { thread: replyTarget.thread } : {}),
      }
    : undefined;

  return {
    id,
    conversationKey,
    replyTarget,
    value,
    ...(rawValue !== undefined ? { rawValue } : {}),
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(messageRef ? { messageRef } : {}),
    actor: actorOf(evt.user),
    identityContext: identityContextOf(
      evt,
      conversationKey,
      "interaction",
      undefined,
    ),
  };
}

function isNormalized(raw: unknown): raw is NormalizedEvent {
  return (
    !!raw &&
    typeof raw === "object" &&
    "kind" in raw &&
    "parameters" in raw &&
    "addOn" in raw
  );
}
