import { createHash } from "node:crypto";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

/**
 * Builds this starter's agent.
 *
 * Extracted from the runtime route so both mounts share one definition: the
 * route serves the web app over HTTP, and `channel-host.mts` serves a Channel.
 * A fresh instance per call — the channel host sets `threadId` per
 * conversation, so a shared instance would leak state across threads.
 */
export function createDefaultAgent(): LangGraphAgent {
  return new LangGraphAgent({
    deploymentUrl:
      process.env.AGENT_URL ||
      process.env.LANGGRAPH_DEPLOYMENT_URL ||
      "http://localhost:8123",
    graphId: "sample_agent",
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  });
}

/**
 * Fixed namespace for channel-thread -> LangGraph-thread derivation.
 *
 * This value is a compatibility contract, not a detail: every checkpointed
 * conversation on a LangGraph deployment is filed under the id it produces.
 * Changing it silently orphans all existing history, so it must stay stable
 * even if this helper moves upstream.
 */
const CHANNEL_THREAD_NAMESPACE = "cd95f0cc-c0ea-46dc-8ce1-7f82fafd1821";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps a Channel thread id onto one the LangGraph platform API will accept.
 *
 * A Channel's thread id identifies a conversation on the provider (a Slack
 * channel plus a message timestamp, say), so it is a provider-shaped string.
 * The LangGraph platform API — including a local `langgraph dev` — validates
 * thread ids as UUIDs and answers `422 Invalid thread ID: must be a UUID` to
 * anything else. Assigning the id verbatim therefore fails every turn inside
 * `getOrCreateThread`, before the model is ever reached, and the caller only
 * sees a generic error.
 *
 * The mapping is a deterministic RFC 4122 v5 UUID rather than a random one on
 * purpose: the same conversation must always resolve to the same LangGraph
 * thread, or checkpointed history is lost on every turn and again on every
 * restart. Ids that are already UUIDs — everything the web app sends — pass
 * through untouched, so this only affects the Channel path.
 */
export function toPlatformThreadId(threadId: string): string {
  if (UUID_PATTERN.test(threadId)) return threadId;

  const bytes = createHash("sha1")
    .update(Buffer.from(CHANNEL_THREAD_NAMESPACE.replace(/-/g, ""), "hex"))
    .update(threadId, "utf8")
    .digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
