// The messaging channels in early access: iMessage, WhatsApp, SMS, and RCS.
// They sit beside Slack and Teams in the frontend picker and on the home
// page, but they aren't docs frontends (`FrontendId`): each has one landing
// page at `/<id>` with a demo booker, and no docs scope, sidebar, or
// llms-full scope.
//
// The docs layout, the frontend picker, and link scoping (live-scope.ts) read
// this module on every docs page, so it holds only what they need: the ids,
// names, and card lines. The landing pages' words are in ./copy, which only
// the landing page, its Markdown, its metadata, and its social card import.
// next.config's redirects can't import app code, so
// src/lib/redirects/next-config-redirects.mjs repeats the ids (a test keeps
// the two lists in step).

/** Every early-access channel, in the picker's and the home page's order. */
export const EARLY_ACCESS_CHANNEL_IDS = [
  "imessage",
  "whatsapp",
  "sms",
  "rcs",
] as const;

export type EarlyAccessChannelId = (typeof EARLY_ACCESS_CHANNEL_IDS)[number];

/** The badge beside an early-access channel's name. */
export const EARLY_ACCESS_LABEL = "Early access";

/** Each channel's display name. */
export const EARLY_ACCESS_CHANNEL_NAMES: Record<EarlyAccessChannelId, string> =
  {
    imessage: "iMessage",
    whatsapp: "WhatsApp",
    sms: "SMS",
    rcs: "RCS",
  };

/** One line for the home page's and the landing pages' cards, <= 70 chars. */
const SUMMARIES: Record<EarlyAccessChannelId, string> = {
  imessage: "Run your agent in iMessage conversations.",
  whatsapp: "Run your agent on WhatsApp. The direct adapter ships today.",
  sms: "Run your agent over SMS.",
  rcs: "Run your agent in RCS business messages.",
};

export interface EarlyAccessChannel {
  id: EarlyAccessChannelId;
  /** "iMessage". */
  name: string;
  /** One line for the home page's and the landing pages' cards. */
  summary: string;
  /**
   * The website's allowlisted booking event (`BOOKING_EVENTS` in
   * CopilotKit/website `src/lib/talkToEngineer/contracts.ts`). For now every
   * channel books the website's "Talk to an Engineer" event, and the booking
   * says which channel it is for in the answer the hosts read (`channelLine`)
   * and in its `ref`. To give a channel its own invite title, create its
   * Calendly event type ("iMessage - Book a Demo"), allowlist it on the
   * website as `<id>_demo`, and name that key here.
   */
  event: ChannelDemoEvent;
  /** The booking ref, which the website sends to Calendly as `utm_content`. */
  ref: `docs_${EarlyAccessChannelId}_early_access`;
  /** Where to book when the page's own booker can't. */
  fallbackUrl: string;
}

/**
 * A booking event the website allowlists: its shared "Talk to an Engineer"
 * event, or a channel's own demo event once the website has one.
 */
export type ChannelDemoEvent =
  | "talk_to_engineer"
  | `${EarlyAccessChannelId}_demo`;

/** The website's booking page, where the fallback links go. */
const BOOKING_PAGE = "https://www.copilotkit.ai/talk-to-an-engineer";

export const EARLY_ACCESS_CHANNELS: readonly EarlyAccessChannel[] =
  EARLY_ACCESS_CHANNEL_IDS.map((id) => ({
    id,
    name: EARLY_ACCESS_CHANNEL_NAMES[id],
    summary: SUMMARIES[id],
    event: "talk_to_engineer",
    ref: `docs_${id}_early_access`,
    fallbackUrl: `${BOOKING_PAGE}?ref=docs_${id}_early_access`,
  }));

/** The early-access channel a URL segment or request names, if it is one. */
export function earlyAccessChannel(
  id: string | null | undefined,
): EarlyAccessChannel | undefined {
  return EARLY_ACCESS_CHANNELS.find((c) => c.id === id);
}

export function isEarlyAccessChannel(
  id: string | null | undefined,
): id is EarlyAccessChannelId {
  return !!earlyAccessChannel(id);
}

/** A channel's landing page. */
export function earlyAccessHref(id: EarlyAccessChannelId) {
  return `/${id}`;
}

/** Whether a pathname is a channel's landing page, or a path under it. */
export function isEarlyAccessPath(pathname: string) {
  return isEarlyAccessChannel(pathname.split("/").filter(Boolean)[0]);
}
