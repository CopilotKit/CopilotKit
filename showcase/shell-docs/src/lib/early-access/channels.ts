import { EARLY_ACCESS_CHANNEL_COPY } from "./copy";
import type { EarlyAccessChannelId } from "./copy";

export type { EarlyAccessChannelId };

// The messaging channels in early access: iMessage, WhatsApp, SMS, and RCS.
// They sit beside Slack and Teams in the frontend picker and on the home
// page, but they aren't docs frontends (`FrontendId`): each has one landing
// page at `/<id>` with a demo booker, and no docs scope, sidebar, search, or
// llms-full scope. Their words live in `./copy`.

export interface EarlyAccessChannel {
  id: EarlyAccessChannelId;
  /** "iMessage". */
  name: string;
  /** One line for the picker's and the home page's cards. */
  summary: string;
  /**
   * The website's allowlisted booking event (`BOOKING_EVENTS` in
   * CopilotKit/website `src/lib/talkToEngineer/contracts.ts`): the Calendly
   * event type "<Name> - Book a Demo", so the invite says what the call is for.
   */
  event: `${EarlyAccessChannelId}_demo`;
  /** The booking ref, which the website sends to Calendly as `utm_content`. */
  ref: `docs_${EarlyAccessChannelId}_early_access`;
  /** Where to book when the page's own booker can't. */
  fallbackUrl: string;
}

/** The website's booking page, where the fallback links go. */
const BOOKING_PAGE = "https://www.copilotkit.ai/talk-to-an-engineer";

/** In the picker's and the home page's order. */
const IDS: readonly EarlyAccessChannelId[] = [
  "imessage",
  "whatsapp",
  "sms",
  "rcs",
];

export const EARLY_ACCESS_CHANNELS: readonly EarlyAccessChannel[] = IDS.map(
  (id) => ({
    id,
    name: EARLY_ACCESS_CHANNEL_COPY[id].name,
    summary: EARLY_ACCESS_CHANNEL_COPY[id].summary,
    event: `${id}_demo`,
    ref: `docs_${id}_early_access`,
    fallbackUrl: `${BOOKING_PAGE}?ref=docs_${id}_early_access`,
  }),
);

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
