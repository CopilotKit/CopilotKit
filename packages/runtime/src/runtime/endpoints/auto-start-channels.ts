import { logger } from "@copilotkit/shared";
import type { ChannelsControl } from "../core/channel-manager";

/**
 * Begin activation of a runtime's declared managed Channels on behalf of a
 * LONG-RUNNING host (OSS-641).
 *
 * The generic Fetch handler deliberately defers activation to the first
 * `channels.ready()`: it is the serverless/edge entry point, where an isolate
 * freezes and recycles per request and separate cold starts would mint
 * competing listeners for the same Channel. That constraint does not apply to a
 * host that owns its own lifetime — a Node server or an Express app — so those
 * wrappers start activation as soon as they are created and leave `ready()` as
 * a pure await-and-observe call.
 *
 * Fire-and-forget by necessity: a factory is synchronous, so the activation
 * outcome cannot be returned. That is a deliberate trade against the failure
 * mode it replaces — a process that serves HTTP, looks healthy, and is silently
 * disconnected because nothing ever called `ready()`. Here the worst case is an
 * activation error in the logs. `ready()` is idempotent and one-shot, so a host
 * that DOES await it afterwards observes THIS activation's outcome (including
 * its rejection reason) rather than triggering a second one.
 *
 * The rejection is logged at `error`, not swallowed: an up-front
 * misconfiguration (duplicate or missing Channel names) rejects `ready()`
 * synchronously-ish from `activate()` and would otherwise be invisible to a
 * host that never awaits `ready()` — the exact silence this change exists to
 * remove. Per-Channel activation failures ALSO emit their own `warn`
 * breadcrumbs through the manager's log bridge (see `fetch-handler.ts`), so the
 * `error` here is the set-level summary, not the only signal.
 *
 * @param channels - The handler's control surface, or `undefined` when the
 *   runtime declares no Channels or opted out via `activateChannels: false`
 *   (both no-op, so the opt-out stays a genuine "open no socket").
 */
export function autoStartChannels(channels: ChannelsControl | undefined): void {
  if (!channels) {
    return;
  }
  channels.ready().catch((err) => {
    logger.error(
      { err },
      "CopilotKit managed Channels failed to activate. The runtime is serving " +
        "requests but one or more declared Channels are not connected.",
    );
  });
}
