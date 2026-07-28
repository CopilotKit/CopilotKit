import type { AbstractAgent } from "@ag-ui/client";
import { logger } from "@copilotkit/shared";
import type { CopilotRuntimeLike } from "./runtime";
import { attachIntelligenceEnterpriseLearning } from "../handlers/shared/agent-utils";
import {
  isUserValidationError,
  validateIntelligenceUser,
} from "../handlers/shared/resolve-intelligence-user";

/**
 * Whether a managed Channel turn in a SHARED conversation may use user-private
 * Intelligence memory.
 *
 * A third value, `"conversation"` — memory scoped to the conversation rather
 * than to any participant — is tracked in OSS-649 and is intended to become the
 * default. It removes this tradeoff instead of gating it, so keep this type open
 * to extension.
 */
export type ChannelMemoryPolicy = "direct-only" | "shared";

/** The turn's sender, as the Channels SDK hands it over. */
export interface ChannelTurnUser {
  /** RAW provider id (Slack `U…`, Teams MRI). Not an Intelligence identity. */
  id: string;
  /** Canonical Intelligence app-user id, when app-api could scope it. */
  appUserId?: string;
  /** Best-effort display name. Profile data only; never affects identity. */
  name?: string;
}

export interface PrepareChannelTurnAgentParams {
  runtime: CopilotRuntimeLike;
  agent: AbstractAgent;
  user?: ChannelTurnUser;
  conversationScope: "direct" | "shared";
  memoryPolicy: ChannelMemoryPolicy;
}

/**
 * Prepare a managed Channel turn's agent with the SENDER's Intelligence identity
 * (OSS-643) — the Channel-side counterpart of the HTTP run's
 * `identifyUser(request)` path. Both funnel into the same
 * `attachIntelligenceEnterpriseLearning`; only acquisition differs.
 *
 * Identity arrives from the trusted delivery actor as an explicit parameter. No
 * fake Request, no mutable closure, no ambient context — concurrent turns from
 * different senders must never observe each other's identity.
 *
 * PRIVACY: a shared Slack/Teams conversation gets NO user-private memory tools
 * by default. The reply is visible to everyone in the room, and the model
 * decides when to call a memory tool — so attaching one there can disclose a
 * sender's private data to their colleagues, triggered by their own message,
 * with no moment where they chose it. Operators opt into that explicitly.
 */
export async function prepareChannelTurnAgent(
  params: PrepareChannelTurnAgentParams,
): Promise<void> {
  const { runtime, agent, user, conversationScope, memoryPolicy } = params;

  if (conversationScope !== "direct" && memoryPolicy === "direct-only") {
    return;
  }

  // The canonical app-user id is REQUIRED here; the raw provider id is not a
  // substitute. Slack ids collide across workspaces, and it would not match
  // `threads.end_user_id`, so memory would attach to a different user than the
  // canonical thread. No canonical id means no user-scoped features this turn.
  if (!user?.appUserId) {
    logger.warn(
      "Channel turn carries no canonical appUserId; running without user-scoped " +
        "Intelligence features. Most likely the provider's adapter config has no " +
        "workspace/tenant id, so Intelligence declined to emit an id that would " +
        "collide across workspaces.",
    );
    return;
  }

  // A display name is profile data and must never decide identity — fall back to
  // the id so a nameless sender cannot fail validation.
  const resolved = validateIntelligenceUser({
    id: user.appUserId,
    name: user.name?.trim() || user.appUserId,
  });
  if (isUserValidationError(resolved)) {
    logger.warn(
      `Channel turn's app user was rejected (${resolved.error}); running without user-scoped Intelligence features.`,
    );
    return;
  }

  await attachIntelligenceEnterpriseLearning({ runtime, agent, user: resolved });
}
