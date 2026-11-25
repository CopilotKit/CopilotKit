import { withBasePath } from "@/lib/base-path";
import {
  EARLY_ACCESS_CHANNELS,
  earlyAccessChannel,
  earlyAccessHref,
} from "./channels";
import type { EarlyAccessChannelId } from "./channels";
import { EARLY_ACCESS_CHANNEL_COPY, SHARED_EARLY_ACCESS_COPY } from "./copy";
import type { ConversationMessage } from "./copy";

// An early-access channel page as Markdown, for agents: what `/whatsapp.md`
// and `Accept: text/markdown` on `/whatsapp` return (src/app/llms.mdx/live),
// in the shape of every docs page's Markdown: the title, the description as
// a quote, then the page. The booker is a link: an agent can't pick a time,
// the reader can.

const fill = (text: string, name: string) => text.replaceAll("{channel}", name);

function transcriptLine(message: ConversationMessage, contact: string) {
  const who = message.from === "person" ? "Person" : contact;
  if (message.kind === "text") return `> **${who}:** ${message.text}`;
  if (message.kind === "choices") {
    return `> **${who}:** ${message.text} (Replies: ${message.choices.join(", ")})`;
  }
  return `> **${who}:** ${message.title}. ${message.body} (Actions: ${message.actions.join(", ")})`;
}

export function channelPageMarkdown(id: EarlyAccessChannelId): string {
  const copy = EARLY_ACCESS_CHANNEL_COPY[id];
  const shared = SHARED_EARLY_ACCESS_COPY;
  const name = copy.name;
  const channel = earlyAccessChannel(id);
  const lines = [
    `# ${copy.hero.title}`,
    "",
    `> ${copy.meta.description}`,
    "",
    copy.hero.lede,
    "",
    `**${shared.eyebrow}:** ${copy.status}`,
    "",
    `## ${copy.booking.heading}`,
    "",
    `${copy.booking.note} Pick a time on [this page](${withBasePath(earlyAccessHref(id))}), or book with the team on [copilotkit.ai](${channel?.fallbackUrl}).`,
    "",
    `## ${fill(shared.conversationTitle, name)}`,
    "",
    copy.conversation.messages
      .map((message) => transcriptLine(message, copy.conversation.contact))
      .join("\n>\n"),
    "",
    `## ${fill(shared.featuresTitle, name)}`,
    "",
    ...copy.features.map((f) => `- **${f.title}.** ${f.body}`),
    "",
    `## ${fill(shared.howItWorks.title, name)}`,
    "",
    fill(shared.howItWorks.lede, name),
    "",
    ...shared.howItWorks.steps.map(
      (step, index) =>
        `${index + 1}. **${fill(step.title, name)}.** ${fill(step.body, name)}`,
    ),
    "",
    `Read the [Channels overview](${withBasePath("/slack")}).`,
    "",
    `## ${fill(shared.specificsTitle, name)}`,
    "",
    ...copy.specifics.map((f) => `- **${f.title}.** ${f.body}`),
    "",
    `## ${copy.closing.title}`,
    "",
    copy.closing.body,
    "",
    `## ${shared.otherChannelsTitle}`,
    "",
    shared.gaChannelsNote,
    "",
    ...EARLY_ACCESS_CHANNELS.filter((c) => c.id !== id).map(
      (c) =>
        `- [${c.name}](${withBasePath(earlyAccessHref(c.id))}) (${shared.eyebrow.toLowerCase()}): ${c.summary}`,
    ),
    `- [Slack](${withBasePath("/slack")})`,
    `- [Microsoft Teams](${withBasePath("/teams")})`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The Markdown route's answer for a channel's path (src/app/llms.mdx/live):
 * the page's Markdown for `/whatsapp`, and a temporary redirect to it for a
 * path under the page (`/whatsapp/quickstart`), as the page itself redirects.
 * next.config redirects those first (`.md`, `.mdx`, and `Accept`); this
 * covers a request straight to the route. Null when the path isn't a
 * channel's.
 */
export function channelMarkdownResponse(path: string[]): Response | null {
  const channel = earlyAccessChannel(path[0]);
  if (!channel) return null;
  if (path.length > 1) {
    return new Response(null, {
      status: 307,
      headers: {
        Location: withBasePath(`${earlyAccessHref(channel.id)}.md`),
      },
    });
  }
  return new Response(channelPageMarkdown(channel.id), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
