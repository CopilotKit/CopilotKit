import type { IngressSink, StateStore } from "@copilotkit/channels-core";
import type { ProviderActor } from "@copilotkit/channels-ui";
import { conversationKeyOf, decodeSelectReply } from "./interaction.js";
import type { InteractionEventBase } from "./interaction.js";
import { clearPendingChoices, readPendingChoices } from "./pending-choices.js";
import type {
  AgentSessionEventWebhook,
  LinearMessageRef,
  LinearWebhookUser,
  ReplyTarget,
} from "./types.js";

const PLATFORM = "linear";

/** What {@link handleAgentSessionEvent} needs from the adapter. */
export interface AgentSessionEventDeps {
  /** Engine sink that receives turns and interactions. */
  sink: Pick<IngressSink, "onTurn" | "onInteraction">;
  /** Adapter state store that holds the pending choice sets. */
  stateStore: StateStore;
  /** Called when the user asks the agent to stop the session's run. */
  onStop: (agentSessionId: string) => void | Promise<void>;
}

function actorOf(user: LinearWebhookUser | undefined) {
  // `id: ""` is the ingress convention for "the provider named nobody".
  if (user === undefined) {
    const nobody: ProviderActor = { id: "", kind: "unknown" };
    return nobody;
  }
  const actor: ProviderActor = {
    id: user.id,
    kind: "human",
    name: user.name,
    email: user.email,
  };
  return actor;
}

/**
 * Text of a `created` turn. Linear's `promptContext` already formats the
 * issue, comments, and guidance for an agent. Without it, the issue and the
 * triggering comment are composed into one prompt.
 */
function createdUserText(payload: AgentSessionEventWebhook) {
  if (payload.promptContext) return payload.promptContext;
  const { issue, comment } = payload.agentSession;
  const parts = [
    issue ? `${issue.identifier}: ${issue.title}` : "",
    issue?.description ?? "",
    comment?.body ?? "",
  ];
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Route one Linear `AgentSessionEvent` webhook into the channel engine.
 *
 * The actor is the user who sent the `prompted` activity, or the session
 * creator for `created`.
 *
 * - `created` (the agent was mentioned or delegated an issue) becomes a turn.
 *   The text is `promptContext`, or the issue plus the triggering comment.
 * - `prompted` with the `stop` signal calls `onStop` and starts no turn.
 * - `prompted` whose body picks an option of the session's pending `select`
 *   elicitation becomes an interaction, and the pending set is cleared.
 * - Any other `prompted` message becomes a turn.
 * - Any other action is ignored.
 *
 * @param payload - A verified `AgentSessionEvent` webhook body.
 * @param deps - The engine sink, the state store, and the stop callback.
 * @example
 * createWebhookHandler({
 *   secret,
 *   onEvent: (event) =>
 *     handleAgentSessionEvent(event, { sink, stateStore, onStop }),
 * });
 */
export async function handleAgentSessionEvent(
  payload: AgentSessionEventWebhook,
  deps: AgentSessionEventDeps,
) {
  const session = payload.agentSession;
  const activity = payload.agentActivity;
  const replyTarget: ReplyTarget = {
    organizationId: payload.organizationId,
    agentSessionId: session.id,
    ...(session.issue ? { issueId: session.issue.id } : {}),
  };
  const conversationKey = conversationKeyOf(session.id);
  const messageRef: LinearMessageRef = {
    id: activity?.id ?? session.id,
    agentSessionId: session.id,
  };
  const eventId = activity?.id ?? `${session.id}:${payload.action}`;
  const baseFor = (trigger: string) => {
    const base: InteractionEventBase = {
      platform: PLATFORM,
      conversationKey,
      replyTarget,
      // The activity's author sent a `prompted` message; a `created` session
      // has no activity, so its creator is the actor.
      actor: actorOf(activity?.user ?? session.creator),
      eventId,
      identityContext: {
        tenant: { id: payload.organizationId },
        installation: { id: payload.organizationId },
        conversation: { id: conversationKey, kind: "thread" },
        trigger,
        event: { id: eventId, occurredAt: payload.createdAt },
        raw: payload,
      },
    };
    return base;
  };
  const turnFor = (trigger: string, userText: string) =>
    deps.sink.onTurn({
      ...baseFor(trigger),
      platform: PLATFORM,
      userText,
      operation: {
        kind: "created",
        logicalMessageId: messageRef.id,
        revisionId: messageRef.id,
        mentioned: true,
      },
      messageRef,
    });

  switch (payload.action) {
    case "created":
      await turnFor("mention", createdUserText(payload));
      return;
    case "prompted": {
      if (activity === undefined) return;
      if (activity.signal === "stop") {
        await deps.onStop(session.id);
        return;
      }
      if (activity.content.type !== "prompt") return;
      const body = activity.content.body;
      const pending = await readPendingChoices(deps.stateStore, session.id);
      const interaction = pending
        ? decodeSelectReply(body, pending, baseFor("interaction"))
        : undefined;
      if (interaction) {
        await clearPendingChoices(deps.stateStore, session.id);
        await deps.sink.onInteraction(interaction);
        return;
      }
      await turnFor("message", body);
      return;
    }
    default:
      // Linear can add actions; the adapter handles only the two above.
      return;
  }
}
