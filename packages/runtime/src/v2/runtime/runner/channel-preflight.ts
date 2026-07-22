import type {
  ChannelAgentRouteContext,
  ChannelConversationKind,
  ChannelRouteEvent,
  ChannelRouteUser,
} from "@copilotkit/channels";

/**
 * Side-effect-free preflight: build the bounded {@link ChannelAgentRouteContext}
 * an agent router receives from a bounded delivery envelope (Task 1/8).
 *
 * The envelope type is declared LOCALLY here (not imported from
 * `@copilotkit/channels-intelligence`) for the same CJS/ESM-boundary reason the
 * {@link ChannelManager} declares its structural transport views locally: the
 * runtime must take no static dependency on the pure-ESM package. It is
 * intentionally a BOUNDED view — it carries only safe, normalized fields and
 * NEVER raw provider requests/payloads, clients, credentials, headers/URLs,
 * file bytes, or unbounded history (see the `ChannelRouteEvent` contract).
 *
 * A9 (DERIVED CONTRACT — reconcile before the beta cut): two route-context
 * fields have NO source in today's ingress envelope and are provisionally
 * defaulted below — `conversation.kind` (defaulted to `"direct_message"`) and a
 * message's `mentioned` (defaulted to `false`). Each is marked `A9 TODO`; the
 * planned §2 spec must either supply these on the envelope (an Intelligence-side
 * extension) or confirm the defaults.
 */

/** The bounded, normalized delivery envelope the preflight consumes. */
export type ChannelDeliveryEnvelope = ChannelDeliveryBase &
  (
    | { kind: "turn"; text?: string }
    | { kind: "command"; command: string; text?: string }
    | { kind: "interaction"; actionId: string; value?: string }
    | { kind: "reaction"; rawEmoji: string }
    | { kind: "thread_started" }
  );

interface ChannelDeliveryBase {
  turnId: string;
  eventId?: string;
  channelName: string;
  platform: string;
  conversationKey: string;
  user?: { id: string; displayName?: string };
}

/** Map the bounded envelope kind to the safe {@link ChannelRouteEvent}. */
function toRouteEvent(env: ChannelDeliveryEnvelope): ChannelRouteEvent {
  switch (env.kind) {
    case "turn":
      return {
        kind: "message",
        ...(env.text !== undefined ? { text: env.text } : {}),
        // A9 TODO: no `mentioned` signal on the envelope yet — default false.
        mentioned: false,
      };
    case "command":
      return {
        kind: "command",
        name: env.command,
        ...(env.text !== undefined ? { args: env.text } : {}),
      };
    case "interaction":
      return {
        kind: "interaction",
        actionId: env.actionId,
        ...(env.value !== undefined ? { value: env.value } : {}),
      };
    case "reaction":
      return { kind: "reaction", name: env.rawEmoji };
    case "thread_started":
      return { kind: "thread_start" };
  }
}

/** Map the bounded envelope user to the safe {@link ChannelRouteUser}. */
function toRouteUser(
  user: ChannelDeliveryBase["user"],
): ChannelRouteUser | undefined {
  if (!user) return undefined;
  return {
    id: user.id,
    ...(user.displayName !== undefined ? { name: user.displayName } : {}),
  };
}

/**
 * Build the route context for `env`. `signal` aborts when the turn is stopped or
 * superseded (owned by the runner's turn lifecycle).
 */
export function buildChannelRouteContext(
  env: ChannelDeliveryEnvelope,
  signal: AbortSignal,
): ChannelAgentRouteContext {
  const user = toRouteUser(env.user);
  // A9 TODO: no conversation-kind signal on the envelope yet — default
  // "direct_message" until the planned §2 spec supplies it.
  const kind: ChannelConversationKind = "direct_message";
  return {
    channelName: env.channelName,
    platform: env.platform,
    turnId: env.turnId,
    conversation: { key: env.conversationKey, kind },
    ...(user ? { user } : {}),
    event: toRouteEvent(env),
    signal,
  };
}
