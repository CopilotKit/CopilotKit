import { EARLY_ACCESS_CHANNELS } from "./channels";
import type { EarlyAccessChannelId } from "./channels";

// What the channel pages' booker and the docs' booking proxy
// (`/api/channel-demo/*`, `./demo-proxy.ts`) send each other. The proxy
// forwards to the website's shared Calendly booker, so the limits and the
// email rule are the website's own (`BOOK_LIMITS` and `isValidChannelsEmail`
// in CopilotKit/website), checked here first so a refusal names its field.

/** The website's book route limits, in characters. */
export const BOOK_LIMITS = {
  name: 100,
  email: 254,
  company: 200,
  building: 2000,
} as const;

/** The website's email rule. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How long a demo is, as the channel events are set up in Calendly. */
export const DEMO_MINUTES = 25;

/**
 * The first line of the answer the hosts read, so the booking names its
 * channel even on an event that isn't the channel's own.
 */
export function channelLine(name: string) {
  return `Channel: ${name} (early access)`;
}

/**
 * The longest answer to "What should your agent do in {channel}?": the
 * website's limit, less the channel line and the blank line after it.
 */
export const ANSWER_LIMIT =
  BOOK_LIMITS.building -
  Math.max(...EARLY_ACCESS_CHANNELS.map((c) => channelLine(c.name).length)) -
  2;

/** `GET /api/channel-demo/slots?channel=<id>`. */
export interface ChannelDemoTimes {
  status: "live" | "unavailable";
  /** Open start times, ISO 8601 in UTC; send one back to book it. */
  slots: { startTime: string }[];
  /** Times on the event's hours that aren't open, shown beside them. */
  unavailable: { startTime: string }[];
}

/** `POST /api/channel-demo/book`. */
export interface ChannelDemoBookRequest {
  channel: EarlyAccessChannelId;
  startTime: string;
  name: string;
  email: string;
  company: string;
  /** The answer to "What should your agent do in {channel}?". */
  building?: string;
  timeZone: string;
  /** The honeypot: empty from a person. */
  kt_hp?: string;
}

export type ChannelDemoField =
  | "name"
  | "email"
  | "company"
  | "building"
  | "timeZone";

export interface ChannelDemoBooking {
  startTime: string;
  rescheduleUrl: string;
  cancelUrl: string;
  /** The hosts' names, when Calendly returned them. */
  hosts: string[];
}

/**
 * The book route's answer. Statuses: 200 booked, 400 `invalid_input`, 409
 * `slot_taken`, 429 `rate_limited`, 503 `unavailable` (nothing was booked),
 * 502 `unconfirmed` (it may have booked: check your email before retrying).
 */
export type ChannelDemoBookResponse =
  | { ok: true; booking: ChannelDemoBooking }
  | {
      ok: false;
      code: "invalid_input";
      field?: ChannelDemoField;
      reason?: "work_email_required";
    }
  | {
      ok: false;
      code: "slot_taken" | "rate_limited" | "unavailable" | "unconfirmed";
    };
