import { isIP } from "node:net";
// `zod/v4`: shell-docs' own zod 4 serves it, and so does the repo root's zod
// 3.25, which is what the unit tests in showcase/scripts resolve.
import { z } from "zod/v4";
import { createRateLimit } from "../rate-limit";
import {
  ANSWER_LIMIT,
  BOOK_LIMITS,
  EMAIL_PATTERN,
  channelLine,
} from "./booking";
import type {
  ChannelDemoBookResponse,
  ChannelDemoField,
  ChannelDemoTimes,
} from "./booking";
import { EARLY_ACCESS_CHANNEL_IDS, earlyAccessChannel } from "./channels";
import type { EarlyAccessChannel } from "./channels";
import { fixtureBooking, fixtureTimes } from "./demo-fixture";
import { isValidTimeZone } from "./time-zones";

// The booking proxy behind the early-access channel pages' booker:
// `GET /api/channel-demo/slots` and `POST /api/channel-demo/book`. The
// website's shared Calendly booker holds the Calendly token, so the docs
// call its `/api/talk-to-engineer/slots` and `/book` routes from the server,
// naming each channel's own event by its allowlisted key, as CopilotKit
// Intelligence's early-access booking does (apps/app-api
// early-access-routes.ts in CopilotKit/Intelligence). Never logs a name, an
// email, or an answer.

const DEFAULT_WEBSITE_URL = "https://www.copilotkit.ai";
const SLOTS_PATH = "/api/talk-to-engineer/slots";
const BOOK_PATH = "/api/talk-to-engineer/book";
/**
 * The website keeps open times for a minute, so many reads aren't cached,
 * and an uncached one can make two Calendly calls in a row after a cold
 * start. The booker waits a little longer than this.
 */
const SLOTS_TIMEOUT_MS = 12_000;
/** The website's book route can take 30 seconds (its maxDuration). */
const BOOK_TIMEOUT_MS = 35_000;
/** A booking is well under this; a larger body isn't one. */
const MAX_BODY_BYTES = 16_384;
/** Fixture answers wait a moment, so the booker's loading states show. */
const FIXTURE_SLOTS_DELAY_MS = 600;
const FIXTURE_BOOK_DELAY_MS = 900;

/**
 * Failures of a connection that never opened, so nothing reached the
 * website: the website's own list (`PRE_CONNECTION_ERROR_CODES` in
 * CopilotKit/website src/lib/talkToEngineer/calendly.ts).
 */
const PRE_CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

// Rate limits, in memory, so per server instance. Every booking reaches the
// website from this server's address, and the website allows five bookings
// a minute per address: so five a minute across all readers, and five in
// ten minutes for each reader, so one reader can't use them all. Every
// booking request, valid or not, also counts toward a ceiling per reader.
// Readers whose address can't be read all have one key (`UNKNOWN_READER`),
// so a limit on that key would let one of them use up the others' allowance.
// They get no limits of their own, only caps they share: together they take
// at most two of the five bookings a minute, so readers with an address
// always keep three, and their reads of the times count toward one cap.

type Limit = ReturnType<typeof createRateLimit>;

/**
 * `own`, counted for each reader. Readers whose address can't be read are
 * counted together by `shared` instead, or not at all.
 */
function perReader(own: Limit, shared?: Limit): Limit {
  return (reader) => {
    if (reader !== UNKNOWN_READER) return own(reader);
    return shared ? shared(reader) : { ok: true };
  };
}

const allowBookRequest = perReader(
  createRateLimit({ limit: 30, windowMs: 60_000 }),
);
/**
 * Of the five bookings a minute across all readers, the most that readers
 * without a readable address take together.
 */
const UNKNOWN_BOOKING_LIMIT = 2;
const allowBooking = perReader(
  createRateLimit({ limit: 5, windowMs: 10 * 60_000 }),
  createRateLimit({ limit: UNKNOWN_BOOKING_LIMIT, windowMs: 60_000 }),
);
/**
 * Reads of the times a minute by all readers without a readable address
 * together: ten readers' worth. Normal traffic stays well under it even if
 * no reader's address can be read; it only keeps a flood off the website.
 */
const UNKNOWN_TIMES_READ_LIMIT = 600;
const allowTimesRead = perReader(
  createRateLimit({ limit: 60, windowMs: 60_000 }),
  createRateLimit({ limit: UNKNOWN_TIMES_READ_LIMIT, windowMs: 60_000 }),
);
const SHARED_BOOKING_LIMIT = 5;
const SHARED_BOOKING_WINDOW_MS = 60_000;
/** When each of the last minute's bookings went to the website. */
const sharedBookings: number[] = [];

const NO_STORE = { "Cache-Control": "no-store" };

const noTimes = (reason: "none" | "error"): ChannelDemoTimes => ({
  status: "unavailable",
  reason,
  slots: [],
  unavailable: [],
});

const FIELDS: ReadonlySet<string> = new Set<ChannelDemoField>([
  "name",
  "email",
  "company",
  "building",
  "timeZone",
]);

function env(name: string) {
  return process.env[name]?.trim() || undefined;
}

/**
 * A route on the website that serves the shared booker
 * (`COPILOTKIT_WEBSITE_URL`, production's by default). Null when that isn't
 * an https URL, and then nothing is sent.
 */
function websiteEndpoint(path: string): URL | null {
  try {
    const base = new URL(env("COPILOTKIT_WEBSITE_URL") ?? DEFAULT_WEBSITE_URL);
    return base.protocol === "https:" ? new URL(path, base) : null;
  } catch {
    return null;
  }
}

/**
 * `CHANNEL_DEMO_FIXTURE=1`: made-up times and bookings, with no network call
 * (./demo-fixture.ts). Ignored in production, so it can never fake a booking
 * there.
 */
function fixtureMode() {
  return (
    process.env.NODE_ENV !== "production" && env("CHANNEL_DEMO_FIXTURE") === "1"
  );
}

/* ---------- the reader's key ---------- */

// Cloudflare's published ranges (https://www.cloudflare.com/ips-v4 and
// https://www.cloudflare.com/ips-v6), as of 2026-11-25.
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

/**
 * The key of every request whose reader's address can't be read. It is no
 * one reader's, so no per-reader limit counts under it (`perReader`).
 */
const UNKNOWN_READER = "unknown";
/** The longest address: IPv6 with an IPv4 tail. */
const MAX_ADDRESS_LENGTH = 45;

type Address = { version: 4; value: number } | { version: 6; groups: number[] };

const ipv4Value = (ip: string) =>
  ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);

/** A valid IPv6 address's eight 16-bit groups. */
function ipv6Groups(ip: string): number[] {
  let text = ip.toLowerCase().split("%")[0];
  // An IPv4 tail (::ffff:1.2.3.4) is the last two groups.
  const tail = /\d+\.\d+\.\d+\.\d+$/.exec(text)?.[0];
  if (tail) {
    const value = ipv4Value(tail);
    const high = Math.floor(value / 65_536).toString(16);
    text = `${text.slice(0, -tail.length)}${high}:${(value % 65_536).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const zeros =
    rest === undefined
      ? []
      : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((group) => parseInt(group, 16));
}

/**
 * An address, checked with `net.isIP`, or null. An IPv4 address mapped into
 * IPv6 (`::ffff:1.2.3.4`) reads as IPv4.
 */
function readAddress(value: string | null): Address | null {
  const text = value?.trim();
  if (!text || text.length > MAX_ADDRESS_LENGTH) return null;
  const version = isIP(text);
  if (version === 4) return { version: 4, value: ipv4Value(text) };
  if (version !== 6) return null;
  const groups = ipv6Groups(text);
  const mapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  return mapped
    ? { version: 4, value: groups[6] * 65_536 + groups[7] }
    : { version: 6, groups };
}

/** Whether two addresses of one version share their first `bits` bits. */
function samePrefix(a: Address, b: Address, bits: number) {
  if (a.version === 4 && b.version === 4) {
    const size = 2 ** (32 - bits);
    return Math.floor(a.value / size) === Math.floor(b.value / size);
  }
  if (a.version === 6 && b.version === 6) {
    for (let i = 0, left = bits; left > 0; i++, left -= 16) {
      const size = 2 ** (16 - Math.min(16, left));
      if (Math.floor(a.groups[i] / size) !== Math.floor(b.groups[i] / size)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

const CLOUDFLARE = CLOUDFLARE_RANGES.map((range) => {
  const [base, bits] = range.split("/");
  return { base: readAddress(base)!, bits: Number(bits) };
});

const fromCloudflare = (address: Address) =>
  CLOUDFLARE.some(({ base, bits }) => samePrefix(address, base, bits));

/** Whether an address is in one of Cloudflare's published ranges. */
export function isCloudflareIp(value: string): boolean {
  const address = readAddress(value);
  return !!address && fromCloudflare(address);
}

/** IPv4 as itself; IPv6 by its /64, which one host can hold all of. */
function keyOf(address: Address) {
  if (address.version === 4) {
    const { value } = address;
    return [value / 16_777_216, value / 65_536, value / 256, value]
      .map((part) => Math.floor(part) % 256)
      .join(".");
  }
  const prefix = address.groups.slice(0, 4).map((g) => g.toString(16));
  return `${prefix.join(":")}::/64`;
}

/**
 * The key a reader's requests count under. Railway's edge sets `x-real-ip`
 * to the address that connected, which is Cloudflare's when Cloudflare
 * fronts the docs; Cloudflare then names the reader in `cf-connecting-ip`,
 * which is believed only then, since a client can send it too.
 * `x-forwarded-for` is never read: its first entry is whatever the client
 * wrote. A request without a readable address (no `x-real-ip`, or a
 * Cloudflare peer that names no reader) gets `UNKNOWN_READER`, which the
 * per-reader limits skip.
 */
export function clientKey(headers: Headers): string {
  const peer = readAddress(headers.get("x-real-ip"));
  if (!peer) return UNKNOWN_READER;
  if (!fromCloudflare(peer)) return keyOf(peer);
  const reader = readAddress(headers.get("cf-connecting-ip"));
  return reader ? keyOf(reader) : UNKNOWN_READER;
}

/** Whether a request without a readable address has been logged yet. */
let unknownReaderLogged = false;

/**
 * `request`'s key (`clientKey`). The first request without a readable
 * address is logged, once per process, so an edge that stops naming readers
 * shows up in the logs. The line names no address.
 */
function readerKey(request: Request) {
  const key = clientKey(request.headers);
  if (key === UNKNOWN_READER && !unknownReaderLogged) {
    unknownReaderLogged = true;
    console.warn(
      "[channel-demo] no readable client address; per-reader limits skipped",
    );
  }
  return key;
}

/* ---------- answers ---------- */

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : typeof error;

/** The network code under a failed fetch (`ENOTFOUND`), if it has one. */
function causeCode(error: unknown) {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === "object" && cause !== null
      ? (cause as { code?: unknown }).code
      : undefined;
  return typeof code === "string" ? code : undefined;
}

/* ---------- start times ---------- */

/** The website's start time: ISO 8601 in UTC, up to nine fraction digits. */
const UTC_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

/** A start time in the website's form, on a day that exists. */
function isStartTime(value: string) {
  const match = UTC_DATE_TIME.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

/* ---------- open times ---------- */

const startTimeSchema = z.object({
  startTime: z.string().max(40, { abort: true }).refine(isStartTime),
});

/** The website's `SlotsResult` when it read the times; only `startTime` is kept. */
const websiteTimesSchema = z.object({
  ok: z.literal(true),
  slots: z.array(startTimeSchema),
  // An event that doesn't list its unavailable times leaves this out.
  unavailable: z.array(startTimeSchema).default([]),
});

/**
 * `GET /api/channel-demo/slots?channel=<id>`: the channel event's open and
 * unavailable times. With no open time, the answer says why: the event has
 * none (`reason: "none"`), or they couldn't be read (`"error"`).
 */
export async function getChannelDemoTimes(request: Request) {
  const channel = earlyAccessChannel(
    new URL(request.url).searchParams.get("channel"),
  );
  if (!channel) return respond(400, noTimes("error"));
  const allowed = allowTimesRead(readerKey(request));
  if (!allowed.ok) {
    return respond(429, noTimes("error"), {
      "Retry-After": String(allowed.retryAfter),
    });
  }
  if (fixtureMode()) {
    await wait(FIXTURE_SLOTS_DELAY_MS);
    return respond(200, fixtureTimes());
  }
  return respond(200, await readWebsiteTimes(channel));
}

async function readWebsiteTimes(
  channel: EarlyAccessChannel,
): Promise<ChannelDemoTimes> {
  const url = websiteEndpoint(SLOTS_PATH);
  if (!url) {
    console.error("[channel-demo] COPILOTKIT_WEBSITE_URL isn't an https URL");
    return noTimes("error");
  }
  url.searchParams.set("event", channel.event);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(SLOTS_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 503 (Calendly unavailable), 400 (an event the website doesn't know
      // yet), 429: the times weren't read. Nothing reads the body.
      await response.body?.cancel().catch(() => {});
      console.warn("[channel-demo] the website returned no open times", {
        channel: channel.id,
        status: response.status,
      });
      return noTimes("error");
    }
    const parsed = websiteTimesSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn("[channel-demo] the website's open times were unreadable", {
        channel: channel.id,
      });
      return noTimes("error");
    }
    const { slots, unavailable } = parsed.data;
    return slots.length
      ? { status: "live", slots, unavailable }
      : noTimes("none");
  } catch (error) {
    console.warn("[channel-demo] the website's open times did not load", {
      channel: channel.id,
      error: errorName(error),
    });
    return noTimes("error");
  }
}

/* ---------- booking ---------- */

// Each length check aborts its field when it fails, so no pattern or check
// after it reads more than the limit.
const bookRequestSchema = z.object({
  channel: z.enum(EARLY_ACCESS_CHANNEL_IDS),
  startTime: z.string().max(40, { abort: true }).refine(isStartTime),
  name: z
    .string()
    .trim()
    .min(1, { abort: true })
    .max(BOOK_LIMITS.name, { abort: true }),
  email: z
    .string()
    .trim()
    .min(1, { abort: true })
    .max(BOOK_LIMITS.email, { abort: true })
    .regex(EMAIL_PATTERN),
  company: z
    .string()
    .trim()
    .min(1, { abort: true })
    .max(BOOK_LIMITS.company, { abort: true }),
  building: z.string().trim().max(ANSWER_LIMIT, { abort: true }).optional(),
  timeZone: z.string().max(64, { abort: true }).refine(isValidTimeZone),
});

type BookInput = z.infer<typeof bookRequestSchema>;

/** The website's booking, when it booked. Its links must be https. */
const websiteBookingSchema = z.object({
  ok: z.literal(true),
  booking: z.object({
    startTime: z.string(),
    rescheduleUrl: z.url({ protocol: /^https$/ }),
    cancelUrl: z.url({ protocol: /^https$/ }),
    hosts: z.array(z.string()),
  }),
});

type Answer = { status: number; body: ChannelDemoBookResponse };

const UNAVAILABLE: Answer = {
  status: 503,
  body: { ok: false, code: "unavailable" },
};
const UNCONFIRMED: Answer = {
  status: 502,
  body: { ok: false, code: "unconfirmed" },
};

/**
 * The body as text, read until `MAX_BODY_BYTES` and no further; null when
 * it is longer, or isn't UTF-8.
 */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function readBookRequest(
  request: Request,
): Promise<{ ok: true; input: BookInput } | { ok: false; field?: string }> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) return { ok: false };
  const text = await readBody(request);
  if (text === null) return { ok: false };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  // A filled honeypot gets the generic refusal before any field is checked,
  // so it learns nothing about the others.
  const honeypot =
    typeof body === "object" && body !== null
      ? (body as { kt_hp?: unknown }).kt_hp
      : undefined;
  if (honeypot !== undefined && honeypot !== "") return { ok: false };
  const parsed = bookRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, input: parsed.data };
  const key = parsed.error.issues[0]?.path[0];
  return { ok: false, field: typeof key === "string" ? key : undefined };
}

/** Seconds until one of the last minute's shared bookings frees up; 0 if one is free. */
function sharedBookingWait(now: number) {
  while (
    sharedBookings.length &&
    now - sharedBookings[0] >= SHARED_BOOKING_WINDOW_MS
  ) {
    sharedBookings.shift();
  }
  return sharedBookings.length < SHARED_BOOKING_LIMIT
    ? 0
    : Math.ceil((sharedBookings[0] + SHARED_BOOKING_WINDOW_MS - now) / 1000);
}

function rateLimited(retryAfter: number) {
  return respond(
    429,
    { ok: false, code: "rate_limited" } satisfies ChannelDemoBookResponse,
    { "Retry-After": String(Math.max(1, retryAfter)) },
  );
}

/**
 * `POST /api/channel-demo/book`: books the time on the channel's own event
 * through the website, for work email addresses only. The answer the hosts
 * read starts with the channel (`channelLine`), and the booking carries the
 * channel's ref as its `utm_content`.
 */
export async function bookChannelDemo(request: Request) {
  const reader = readerKey(request);
  const attempt = allowBookRequest(reader);
  if (!attempt.ok) return rateLimited(attempt.retryAfter);

  const read = await readBookRequest(request);
  if (!read.ok) {
    const field =
      read.field && FIELDS.has(read.field)
        ? (read.field as ChannelDemoField)
        : undefined;
    return respond(400, {
      ok: false,
      code: "invalid_input",
      ...(field ? { field } : {}),
    } satisfies ChannelDemoBookResponse);
  }
  const { channel: id, building, ...booking } = read.input;
  const channel = earlyAccessChannel(id)!;

  if (fixtureMode()) {
    const allowed = allowBooking(reader);
    if (!allowed.ok) return rateLimited(allowed.retryAfter);
    await wait(FIXTURE_BOOK_DELAY_MS);
    const { status, body } = fixtureBooking({ ...booking, channel: id });
    return respond(status, body);
  }

  const url = websiteEndpoint(BOOK_PATH);
  if (!url) {
    console.error("[channel-demo] COPILOTKIT_WEBSITE_URL isn't an https URL");
    return respond(UNAVAILABLE.status, UNAVAILABLE.body);
  }
  // The shared limit first, and a shared booking is counted only once the
  // reader's own limit (without an address, their shared cap) allows it, so
  // a reader past theirs uses up nobody's.
  const now = Date.now();
  const sharedWait = sharedBookingWait(now);
  if (sharedWait) return rateLimited(sharedWait);
  const allowed = allowBooking(reader);
  if (!allowed.ok) return rateLimited(allowed.retryAfter);
  sharedBookings.push(now);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...booking,
        building: [channelLine(channel.name), building]
          .filter(Boolean)
          .join("\n\n"),
        kt_hp: "",
        event: channel.event,
        ref: channel.ref,
        workEmailOnly: true,
      }),
      cache: "no-store",
      // Followed, a redirect would carry the reader's details on to wherever
      // it points, and could book twice. Node's fetch hands back the 3xx
      // itself, which reads as unconfirmed.
      redirect: "manual",
      signal: AbortSignal.timeout(BOOK_TIMEOUT_MS),
    });
  } catch (error) {
    // A connection that never opened sent nothing. Anything else, a timeout
    // above all, may still have booked the time.
    const code = causeCode(error);
    console.error("[channel-demo] the website's book route did not answer", {
      channel: channel.id,
      error: errorName(error),
      ...(code ? { code } : {}),
    });
    const answer =
      code && PRE_CONNECTION_ERROR_CODES.has(code) ? UNAVAILABLE : UNCONFIRMED;
    return respond(answer.status, answer.body);
  }
  const { status, body } = await readWebsiteBooking(response);
  if (response.status === 429 || status >= 500) {
    // Rate limited, unavailable (nothing booked), or unconfirmed (it may
    // have booked).
    console.error("[channel-demo] the website did not confirm a booking", {
      channel: channel.id,
      status: response.status,
    });
  }
  return respond(status, body);
}

/**
 * The website's answer, mapped as Intelligence maps it. Anything that isn't
 * a clear "not booked", a redirect among them, is reported as possibly
 * booked, so the reader checks their email instead of booking twice.
 */
async function readWebsiteBooking(response: Response): Promise<Answer> {
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = websiteBookingSchema.safeParse(body);
    return parsed.success
      ? { status: 200, body: { ok: true, booking: parsed.data.booking } }
      : UNCONFIRMED;
  }
  if (response.status === 400) {
    const refusal =
      typeof body === "object" && body !== null
        ? (body as { field?: unknown; reason?: unknown })
        : {};
    if (refusal.reason === "work_email_required") {
      return {
        status: 400,
        body: {
          ok: false,
          code: "invalid_input",
          field: "email",
          reason: "work_email_required",
        },
      };
    }
    const field =
      typeof refusal.field === "string" && FIELDS.has(refusal.field)
        ? (refusal.field as ChannelDemoField)
        : undefined;
    return {
      status: 400,
      body: { ok: false, code: "invalid_input", ...(field ? { field } : {}) },
    };
  }
  if (response.status === 409) {
    return { status: 409, body: { ok: false, code: "slot_taken" } };
  }
  if (response.status === 429) {
    return { status: 429, body: { ok: false, code: "rate_limited" } };
  }
  if (response.status === 404 || response.status === 503) return UNAVAILABLE;
  return UNCONFIRMED;
}
