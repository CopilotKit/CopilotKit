import { withBasePath } from "../base-path";
import type {
  ChannelDemoBookRequest,
  ChannelDemoBookResponse,
  ChannelDemoBooking,
} from "./booking";

// The booker's side of `POST /api/channel-demo/book` (./demo-proxy.ts): it
// sends the reader's booking and reads the proxy's answer.

const BOOK_ENDPOINT = "/api/channel-demo/book";
/**
 * The proxy gives the website 35 seconds to book; this covers that and the
 * trip. Past it the booking may still go through, so it reads as unconfirmed.
 */
const BOOK_DEADLINE_MS = 40_000;

type Failure = Exclude<ChannelDemoBookResponse, { ok: true }>;

const isFailure = (value: unknown): value is Failure => {
  if (typeof value !== "object" || value === null) return false;
  const body = value as { ok?: unknown; code?: unknown };
  return (
    body.ok === false &&
    typeof body.code === "string" &&
    [
      "invalid_input",
      "slot_taken",
      "rate_limited",
      "unavailable",
      "unconfirmed",
    ].includes(body.code)
  );
};

const isBooking = (value: unknown): value is ChannelDemoBooking => {
  if (typeof value !== "object" || value === null) return false;
  const booking = value as Record<string, unknown>;
  return (
    typeof booking.startTime === "string" &&
    typeof booking.rescheduleUrl === "string" &&
    typeof booking.cancelUrl === "string" &&
    Array.isArray(booking.hosts) &&
    booking.hosts.every((host) => typeof host === "string")
  );
};

/**
 * Books through the docs' proxy. A network error, or an answer that isn't
 * the proxy's, may still have booked, so it reads as unconfirmed: the reader
 * checks their inbox before trying again. The exception is a refusal (4xx)
 * that isn't the proxy's, such as a firewall's page: nothing was booked.
 * Without a whole answer by `BOOK_DEADLINE_MS`, the booking is unconfirmed
 * too. It is never sent again: the first try may have booked.
 */
export async function postBooking(
  request: ChannelDemoBookRequest,
): Promise<ChannelDemoBookResponse> {
  // One deadline for the request and its answer's body.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), BOOK_DEADLINE_MS);
  try {
    let response: Response;
    try {
      response = await fetch(withBasePath(BOOK_ENDPOINT), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, code: "unconfirmed" };
    }
    const body: unknown = await response.json().catch(() => null);
    // The deadline cut the answer off: it may still have booked.
    if (controller.signal.aborted) return { ok: false, code: "unconfirmed" };
    if (typeof body === "object" && body !== null) {
      const answer = body as { ok?: unknown; booking?: unknown };
      if (answer.ok === true && isBooking(answer.booking)) {
        return { ok: true, booking: answer.booking };
      }
      if (isFailure(body)) return body;
    }
    // An edge in front of the docs answers a flood with a bare 429.
    if (response.status === 429) return { ok: false, code: "rate_limited" };
    return response.status >= 400 && response.status < 500
      ? { ok: false, code: "unavailable" }
      : { ok: false, code: "unconfirmed" };
  } finally {
    clearTimeout(deadline);
  }
}
