// The booking details of the frontends in early access (iMessage, WhatsApp,
// SMS, and RCS). They are ordinary frontends in the frontend list
// (src/lib/frontends.ts), flagged `earlyAccess`, so their ids, names, and
// card lines come from there; this module adds only what the landing page's
// demo booker and its proxy need.
//
// It imports only the frontend list, by a relative path so the booking
// proxy's tests load it without the app's `@/` alias.
//
// next.config's redirects can't import app code, so
// src/lib/redirects/next-config-redirects.mjs repeats the ids (a test keeps
// the two lists in step).

import {
  EARLY_ACCESS_LABEL,
  FRONTENDS,
  isEarlyAccessFrontend,
  landingPage,
} from "../frontends";
import type { EarlyAccessFrontendId } from "../frontends";

export { EARLY_ACCESS_LABEL };

export type EarlyAccessChannelId = EarlyAccessFrontendId;

/** Every early-access channel, in the frontend list's order. */
export const EARLY_ACCESS_CHANNEL_IDS = FRONTENDS.flatMap((f) =>
  isEarlyAccessFrontend(f.id) ? [f.id] : [],
);

/** Each channel's display name. */
export const EARLY_ACCESS_CHANNEL_NAMES = Object.fromEntries(
  FRONTENDS.flatMap((f) =>
    isEarlyAccessFrontend(f.id) ? [[f.id, f.name]] : [],
  ),
) as Record<EarlyAccessChannelId, string>;

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
  FRONTENDS.flatMap(({ id, name, summary }): EarlyAccessChannel[] =>
    isEarlyAccessFrontend(id)
      ? [
          {
            id,
            name,
            summary,
            event: "talk_to_engineer",
            ref: `docs_${id}_early_access`,
            fallbackUrl: `${BOOKING_PAGE}?ref=docs_${id}_early_access`,
          },
        ]
      : [],
  );

/** The early-access channel a URL segment or request names, if it is one. */
export function earlyAccessChannel(
  id: string | null | undefined,
): EarlyAccessChannel | undefined {
  return EARLY_ACCESS_CHANNELS.find((c) => c.id === id);
}

/** A channel's landing page, its only page (`landingPage`). */
export function earlyAccessHref(id: EarlyAccessChannelId) {
  return landingPage(id)!;
}
