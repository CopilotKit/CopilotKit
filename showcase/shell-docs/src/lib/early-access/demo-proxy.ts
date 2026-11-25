import { z } from "zod";
import { createRateLimit } from "@/lib/rate-limit";
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
import { earlyAccessChannel, isEarlyAccessChannel } from "./channels";
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
/** The website caches its open times, so a slow answer means trouble. */
const SLOTS_TIMEOUT_MS = 5_000;
/** The website's book route can take 30 seconds (its maxDuration). */
const BOOK_TIMEOUT_MS = 35_000;
/** A booking is well under this; a larger body isn't one. */
const MAX_BODY_BYTES = 16_384;
/** Fixture answers wait a moment, so the booker's loading states show. */
const FIXTURE_SLOTS_DELAY_MS = 600;
const FIXTURE_BOOK_DELAY_MS = 900;

// Per reader IP, in memory, so per server instance. Every booking reaches
// the website from this server's IP, and the website allows five bookings a
// minute per IP, so one reader must not use them all up.
const allowBooking = createRateLimit({ limit: 5, windowMs: 10 * 60_000 });
const allowTimesRead = createRateLimit({ limit: 60, windowMs: 60_000 });

const NO_STORE = { "Cache-Control": "no-store" };

const UNAVAILABLE: ChannelDemoTimes = {
  status: "unavailable",
  slots: [],
  unavailable: [],
};

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

/** The website that serves the shared booker (`COPILOTKIT_WEBSITE_URL`). */
export function websiteUrl() {
  return (env("COPILOTKIT_WEBSITE_URL") ?? DEFAULT_WEBSITE_URL).replace(
    /\/+$/,
    "",
  );
}

/**
 * `CHANNEL_DEMO_FIXTURE=1`: made-up times and bookings, with no network call
 * (./demo-fixture.ts). Ignored in production, so it can never fake a booking
 * there.
 */
export function fixtureMode() {
  return (
    process.env.NODE_ENV !== "production" && env("CHANNEL_DEMO_FIXTURE") === "1"
  );
}

/**
 * The reader's IP, read as the docs' server-side telemetry reads it
 * (src/lib/telemetry/proxy.ts): behind Cloudflare, `cf-connecting-ip`; else
 * the left-most `x-forwarded-for` entry; else `x-real-ip`.
 */
export function clientIp(request: Request) {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function respond(status: number, body: unknown, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : typeof error;

/* ---------- open times ---------- */

const startTimeSchema = z.object({ startTime: z.iso.datetime() });

/** The website's `SlotsResult` when it has times; only `startTime` is kept. */
const websiteTimesSchema = z.object({
  ok: z.literal(true),
  slots: z.array(startTimeSchema),
  // An event that doesn't list its unavailable times leaves this out.
  unavailable: z.array(startTimeSchema).default([]),
});

/**
 * `GET /api/channel-demo/slots?channel=<id>`: the channel event's open and
 * unavailable times. Any failure is `status: "unavailable"`, which the
 * booker answers with its fallback link.
 */
export async function getChannelDemoTimes(request: Request) {
  const channel = earlyAccessChannel(
    new URL(request.url).searchParams.get("channel"),
  );
  if (!channel) return respond(400, UNAVAILABLE);
  const allowed = allowTimesRead(clientIp(request));
  if (!allowed.ok) {
    return respond(429, UNAVAILABLE, {
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
  const url = new URL(SLOTS_PATH, websiteUrl());
  url.searchParams.set("event", channel.event);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(SLOTS_TIMEOUT_MS),
    });
    // 503 (Calendly unavailable) and 400 (an event the website doesn't
    // know yet) both mean no times.
    const parsed = response.ok
      ? websiteTimesSchema.safeParse(await response.json())
      : null;
    if (parsed?.success) {
      return parsed.data.slots.length
        ? {
            status: "live",
            slots: parsed.data.slots,
            unavailable: parsed.data.unavailable,
          }
        : UNAVAILABLE;
    }
    console.warn("[channel-demo] the website returned no open times", {
      channel: channel.id,
      status: response.status,
    });
  } catch (error) {
    console.warn("[channel-demo] the website's open times did not load", {
      channel: channel.id,
      error: errorName(error),
    });
  }
  return UNAVAILABLE;
}

/* ---------- booking ---------- */

const bookRequestSchema = z.object({
  channel: z.string().refine(isEarlyAccessChannel),
  startTime: z.iso.datetime(),
  name: z.string().trim().min(1).max(BOOK_LIMITS.name),
  email: z.string().trim().min(1).max(BOOK_LIMITS.email).regex(EMAIL_PATTERN),
  company: z.string().trim().min(1).max(BOOK_LIMITS.company),
  building: z.string().trim().max(ANSWER_LIMIT).optional(),
  timeZone: z.string().refine(isValidTimeZone),
  kt_hp: z.string().max(500).optional(),
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

const UNCONFIRMED: Answer = {
  status: 502,
  body: { ok: false, code: "unconfirmed" },
};

async function readBookRequest(
  request: Request,
): Promise<{ ok: true; input: BookInput } | { ok: false; field?: string }> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) return { ok: false };
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { ok: false };
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false };
    body = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const parsed = bookRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, input: parsed.data };
  const key = parsed.error.issues[0]?.path[0];
  return { ok: false, field: typeof key === "string" ? key : undefined };
}

/**
 * `POST /api/channel-demo/book`: books the time on the channel's own event
 * through the website, for work email addresses only. The answer the hosts
 * read starts with the channel (`channelLine`), and the booking carries the
 * channel's ref as its `utm_content`.
 */
export async function bookChannelDemo(request: Request) {
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
  const { channel: id, building, kt_hp, ...booking } = read.input;
  // A filled honeypot gets the generic refusal, and never reaches the website.
  if (kt_hp) {
    return respond(400, {
      ok: false,
      code: "invalid_input",
    } satisfies ChannelDemoBookResponse);
  }
  const allowed = allowBooking(clientIp(request));
  if (!allowed.ok) {
    return respond(
      429,
      { ok: false, code: "rate_limited" } satisfies ChannelDemoBookResponse,
      { "Retry-After": String(allowed.retryAfter) },
    );
  }
  const channel = earlyAccessChannel(id)!;

  if (fixtureMode()) {
    await wait(FIXTURE_BOOK_DELAY_MS);
    const { status, body } = fixtureBooking({
      ...booking,
      channel: channel.id,
    });
    return respond(status, body);
  }

  let response: Response;
  try {
    response = await fetch(new URL(BOOK_PATH, websiteUrl()), {
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
      signal: AbortSignal.timeout(BOOK_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout or a dropped connection may still have booked the time.
    console.error("[channel-demo] the website's book route did not answer", {
      channel: channel.id,
      error: errorName(error),
    });
    return respond(UNCONFIRMED.status, UNCONFIRMED.body);
  }
  const { status, body } = await readWebsiteBooking(response);
  if (!body.ok && status >= 500) {
    // Unavailable (nothing booked) or unconfirmed (it may have booked).
    console.error("[channel-demo] the website did not confirm a booking", {
      channel: channel.id,
      status: response.status,
      code: body.code,
    });
  }
  return respond(status, body);
}

/**
 * The website's answer, mapped as Intelligence maps it. Anything that isn't
 * a clear "not booked" is reported as possibly booked, so the reader checks
 * their email instead of booking twice.
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
  if (response.status === 404 || response.status === 503) {
    return { status: 503, body: { ok: false, code: "unavailable" } };
  }
  return UNCONFIRMED;
}
