/**
 * Slack-platform-universal frontend tools — tools every Slack bot
 * benefits from, regardless of what the bot does. Apps spread
 * `defaultSlackTools` into the `tools:` config they pass to
 * `createChannel`.
 */
import {
  defineChannelTool,
  singleStringParameterSchema,
} from "@copilotkit/channels-core";
import type { ChannelTool } from "@copilotkit/channels-core";

/**
 * Parameter schema for `lookup_slack_user`.
 *
 * Built by `singleStringParameterSchema` rather than by `z.object`, so that
 * `@copilotkit/channels-slack` declares no `zod` range. See that helper for
 * why the range was not free (OSS-1173, PE-30). It emits the same JSON
 * Schema document the Zod object emitted, so the descriptor the model is
 * shown is unchanged.
 *
 * This file used to carry its own copy of the validator. Discord and Telegram
 * needed the identical schema, so it moved to `channels-core` rather than
 * being written a third time.
 */
const lookupSchema = singleStringParameterSchema({
  name: "query",
  description:
    "Handle, display name, first name, or email of the person to look up.",
  vendor: "@copilotkit/channels-slack",
});

export const lookupSlackUserTool = defineChannelTool({
  name: "lookup_slack_user",
  description:
    "Resolve a person to a Slack user ID so you can @-mention them. " +
    "Accepts a handle (`atai`), display name (`Atai Barkai`), first name, " +
    "or email. Returns an object with `found`, and on success a " +
    "`mention` string (e.g. `<@U0B45V75NNR>`) — put that string verbatim " +
    "in your reply to ping them. If `found` is false, write the plain " +
    "name instead.",
  parameters: lookupSchema,
  async handler({ query }, { thread }) {
    const u = await thread.lookupUser(query);
    return u
      ? {
          found: true,
          query,
          userId: u.id,
          name: u.name,
          handle: u.handle,
          email: u.email,
          mention: `<@${u.id}>`,
        }
      : { found: false, query };
  },
});

/**
 * The flat list of tools the SDK ships. Spread into your
 * `createChannel({tools: …})`:
 *
 *     tools: [...defaultSlackTools, ...myAppTools],
 */
export const defaultSlackTools: ReadonlyArray<ChannelTool> = [
  lookupSlackUserTool,
];
