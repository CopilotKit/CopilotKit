/**
 * Hello-world frontend tool — a minimal worked example of the
 * `FrontendTool` shape, including how to use the Slack `ctx` to talk
 * to Slack from inside a tool. Apps can study this as a template,
 * then delete it (or leave it; the LLM ignores tools it doesn't need).
 *
 * Anatomy of a frontend tool:
 *   - Declare arg shape as a Zod schema. The SDK converts it to JSON
 *     Schema for the LLM and `safeParse`s the LLM's tool-call args
 *     before invoking `execute`.
 *   - `execute` returns a string — typically `JSON.stringify(...)` —
 *     which the SDK appends to the agent's message history as a
 *     tool-result message. The agent then sees it on its next turn.
 *   - The `ctx` arg gives you the Slack `WebClient`, the channel id,
 *     the bot's own user id, and the optional thread ts. That's
 *     enough to react to messages, post Block Kit, look up users,
 *     fetch channel metadata, etc. — all directly from the tool.
 *
 * This example shows the ctx in action: it calls
 * `client.conversations.info` to resolve the channel id to a human
 * channel name, then returns a greeting that includes it alongside
 * the rest of the context fields.
 */
import { z } from "zod";
import type { FrontendTool } from "../../src/index.js";

const helloSchema = z.object({
  recipient: z
    .string()
    .min(1)
    .describe("Whoever the greeting should mention by name."),
});

export const helloWorldTool: FrontendTool<typeof helloSchema> = {
  name: "hello_world",
  description:
    "An example tool included to demonstrate the FrontendTool shape. " +
    "Call it with {recipient: 'someone'} to get a JSON greeting back " +
    "that includes the resolved Slack channel name (proof that the tool " +
    "used its Slack ctx).",
  parameters: helloSchema,
  async execute({ recipient }, ctx) {
    let channelName: string | undefined;
    try {
      const r = (await ctx.client.conversations.info({
        channel: ctx.channel,
      })) as { ok?: boolean; channel?: { name?: string } };
      channelName = r.channel?.name;
    } catch (err) {
      // Missing scope or DM with no name — degrade gracefully.
      return JSON.stringify({
        ok: true,
        message: `Hello, ${recipient}!`,
        ctx: {
          channel: ctx.channel,
          threadTs: ctx.threadTs,
          botUserId: ctx.botUserId,
        },
        slackLookupError: (err as Error).message,
      });
    }

    return JSON.stringify({
      ok: true,
      message: channelName
        ? `Hello, ${recipient}! Greeting from #${channelName}.`
        : `Hello, ${recipient}!`,
      ctx: {
        channel: ctx.channel,
        channelName,
        threadTs: ctx.threadTs,
        botUserId: ctx.botUserId,
      },
    });
  },
};
