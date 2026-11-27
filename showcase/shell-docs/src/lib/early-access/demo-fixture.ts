import type {
  ChannelDemoBookRequest,
  ChannelDemoBookResponse,
  ChannelDemoTimes,
} from "./booking";
import { offsetMinutes } from "./time-zones";

// Fixture mode for the booking proxy (`CHANNEL_DEMO_FIXTURE=1`, never in
// production): made-up open times and a fake booking, with no network call,
// so the booker can be worked on and screenshotted without Calendly. The
// work email check and the failures are simulated from the email address:
//
//   a free mail domain (gmail.com, ...)   400, work email required
//   slot-taken@<any work domain>          409, the time was just taken
//   rate-limited@...                      429, too many bookings
//   unavailable@...                       503, booking is unavailable
//   unconfirmed@...                       502, it may or may not have booked
//
// Anything else books.

/** The hosts' zone and hours: weekdays, 9:00 to 16:30, every 30 minutes. */
const ZONE = "America/Los_Angeles";
const FIRST_MINUTE = 9 * 60;
const LAST_MINUTE = 16 * 60 + 30;
const STEP_MINUTES = 30;
const WEEKDAYS = 10;
const LEAD_MS = 5 * 60_000;

/** Free mail domains the fixture refuses; the website's own list is longer. */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const DAY_MS = 86_400_000;

/** The UTC instant of a wall-clock time on a day in `ZONE`. */
function zonedTime(year: number, month: number, day: number, minute: number) {
  const guess = Date.UTC(year, month - 1, day, 0, minute);
  const first = guess - offsetMinutes(ZONE, guess) * 60_000;
  // Across a clock change the offset at the answer can differ from the guess's.
  return guess - offsetMinutes(ZONE, first) * 60_000;
}

/** Open and unavailable times for the next ten weekdays. */
export function fixtureTimes(now = Date.now()): ChannelDemoTimes {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  const slots: { startTime: string }[] = [];
  const unavailable: { startTime: string }[] = [];
  let weekdays = 0;
  for (let offset = 0; weekdays < WEEKDAYS; offset++) {
    const date = new Date(Date.UTC(year, month - 1, day) + offset * DAY_MS);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    for (
      let minute = FIRST_MINUTE;
      minute <= LAST_MINUTE;
      minute += STEP_MINUTES
    ) {
      const ms = zonedTime(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        minute,
      );
      if (ms <= now + LEAD_MS) continue;
      // The website's form: ISO 8601 in UTC, without milliseconds.
      const startTime = new Date(ms).toISOString().replace(".000Z", "Z");
      // A few taken times on each day, in a pattern that shifts by day.
      const taken = (weekdays * 3 + minute / STEP_MINUTES) % 7 === 2;
      (taken ? unavailable : slots).push({ startTime });
    }
    weekdays++;
  }
  return { status: "live", slots, unavailable };
}

/** What booking `request` answers in fixture mode, with its HTTP status. */
export function fixtureBooking(request: ChannelDemoBookRequest): {
  status: number;
  body: ChannelDemoBookResponse;
} {
  const at = request.email.lastIndexOf("@");
  const local = request.email.slice(0, at).toLowerCase();
  const domain = request.email.slice(at + 1).toLowerCase();
  if (FREE_MAIL.has(domain)) {
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
  switch (local) {
    case "slot-taken":
      return { status: 409, body: { ok: false, code: "slot_taken" } };
    case "rate-limited":
      return { status: 429, body: { ok: false, code: "rate_limited" } };
    case "unavailable":
      return { status: 503, body: { ok: false, code: "unavailable" } };
    case "unconfirmed":
      return { status: 502, body: { ok: false, code: "unconfirmed" } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      booking: {
        startTime: request.startTime,
        rescheduleUrl:
          "https://calendly.com/reschedulings/channel-demo-fixture",
        cancelUrl: "https://calendly.com/cancellations/channel-demo-fixture",
        hosts: [],
      },
    },
  };
}
