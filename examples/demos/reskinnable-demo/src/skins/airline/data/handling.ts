/**
 * BEAT 5's vocabulary — the one that is GIVEN to the agent.
 *
 * Everything here is meant to reach the model: enumerate it on the tool schemas,
 * name it in the prompt, quote it back in refusal bodies. There is nothing to
 * discover in this file. The whole claim of beat 5 is that the assistant ALREADY
 * knows the procedure, so hiding its steps would be hiding the demonstration.
 *
 * ⚠️ That is the exact OPPOSITE of `fare-waiver-codes.ts`, and the contrast is
 * the point. The two vocabularies live in two modules that share no token, so a
 * future edit reaching for "the codes file" cannot pull the withheld one into
 * `tools.tsx`. Nothing in this file names a fare condition, a category or a
 * ground; `fare-waiver-codes.test.ts` asserts the separation both ways.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

/**
 * Who downstream of the trip gets told when it moves. A passenger's version of
 * "notify the carrier": the person meeting them, the room they booked, whoever
 * they are travelling with, and the desk that books their work travel.
 */
export const NOTIFY_PARTIES = [
  "arrival-pickup",
  "hotel",
  "travel-companion",
  "employer-travel-desk",
] as const;

export type NotifyParty = (typeof NOTIFY_PARTIES)[number];

export const NOTIFY_PARTY_LABELS: Record<NotifyParty, string> = {
  "arrival-pickup": "Whoever is meeting the flight",
  hotel: "The hotel holding the room",
  "travel-companion": "The person travelling with them",
  "employer-travel-desk": "Their employer's travel desk",
};

/** The templated messages Aeronova sends. Closed, and deliberately visible. */
export const NOTICE_TEMPLATES = [
  "delay-advisory",
  "new-arrival-time",
  "pickup-update",
  "room-hold-request",
] as const;

export type NoticeTemplate = (typeof NOTICE_TEMPLATES)[number];

export const NOTICE_TEMPLATE_LABELS: Record<NoticeTemplate, string> = {
  "delay-advisory": "The flight is running late",
  "new-arrival-time": "The arrival time has moved",
  "pickup-update": "Updated pickup details",
  "room-hold-request": "Please hold the room for a late arrival",
};

/**
 * BEAT 4 + BEAT 5 step 2 — the seat preferences the reseat write understands.
 * Given to the agent, exactly as the two above are.
 */
export const SEAT_PREFERENCES = [
  "aisle",
  "window",
  "forward-cabin",
  "exit-row",
] as const;

export type SeatPreference = (typeof SEAT_PREFERENCES)[number];

export const SEAT_PREFERENCE_LABELS: Record<SeatPreference, string> = {
  aisle: "On the aisle",
  window: "At the window",
  "forward-cabin": "Forward of the wing",
  "exit-row": "In an exit row",
};

export const isNotifyParty = (value: string): value is NotifyParty =>
  (NOTIFY_PARTIES as readonly string[]).includes(value);

export const isNoticeTemplate = (value: string): value is NoticeTemplate =>
  (NOTICE_TEMPLATES as readonly string[]).includes(value);

export const isSeatPreference = (value: string): value is SeatPreference =>
  (SEAT_PREFERENCES as readonly string[]).includes(value);

/**
 * The marker forced onto every notice entry on the trip log.
 *
 * Forced by `markNote`, never requested from the caller: the point of the entry
 * is that the room can SEE the record moved from the back of the room, and a
 * model that phrases it plainly would silently cost the beat its only visible
 * artifact.
 */
export const NOTE_MARKER = "🚨";

export const markNote = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.startsWith(NOTE_MARKER)
    ? trimmed
    : `${NOTE_MARKER} ${trimmed}`;
};

// ---------------------------------------------------------------------------
// Seat geometry — a narrow-body 3-3 cabin, which is what this skin's own seat
// map (`data/seed.ts`) already draws. Kept here rather than in the reseat route
// so the page, the tool and the server all agree on what "aisle" means.
// ---------------------------------------------------------------------------

const WINDOW_COLUMNS = new Set(["A", "F"]);
const AISLE_COLUMNS = new Set(["C", "D"]);

/** Rows at or ahead of this are "forward of the wing" on the seeded fleet. */
export const FORWARD_CABIN_LAST_ROW = 8;

/** Rows offered as exit rows on the seeded fleet. */
export const EXIT_ROWS = new Set([12]);

export interface SeatCoordinates {
  row: number;
  column: string;
}

/**
 * Split a seat id into row and column, or `null` when it is not a seat id.
 *
 * REFUSES rather than coerces, for the same reason `parseTopLever` does: a seat
 * the flight does not have must not be treated as a seat somewhere plausible.
 */
export function parseSeatId(seatId: string): SeatCoordinates | null {
  const match = /^([0-9]{1,2})([A-F])$/.exec(seatId.trim().toUpperCase());
  if (!match) return null;
  const row = Number(match[1]);
  return row > 0 ? { row, column: match[2] } : null;
}

export type ColumnKind = "window" | "aisle" | "middle";

export function columnKind(column: string): ColumnKind {
  const upper = column.trim().toUpperCase();
  if (WINDOW_COLUMNS.has(upper)) return "window";
  if (AISLE_COLUMNS.has(upper)) return "aisle";
  return "middle";
}

/** Whether a seat satisfies a preference. Unparseable seat ids satisfy none. */
export function seatMatchesPreference(
  seatId: string,
  preference: SeatPreference,
): boolean {
  const seat = parseSeatId(seatId);
  if (!seat) return false;
  switch (preference) {
    case "aisle":
      return columnKind(seat.column) === "aisle";
    case "window":
      return columnKind(seat.column) === "window";
    case "forward-cabin":
      return seat.row <= FORWARD_CABIN_LAST_ROW;
    case "exit-row":
      return EXIT_ROWS.has(seat.row);
  }
}

/**
 * The best free seat for a preference, or `null` when the flight has none.
 *
 * `null` rather than "the nearest thing" on purpose: a reseat that quietly
 * lands the passenger in a middle seat and reports success is exactly the
 * confident falsehood this app fails toward. The caller refuses out loud
 * instead, and the passenger keeps the seat they had.
 *
 * Ties break forward, then by column order, so the choice is deterministic and
 * a test can assert it.
 */
export function pickSeatForPreference(
  availableSeats: string[],
  preference: SeatPreference,
): string | null {
  const candidates = availableSeats
    .filter((seatId) => seatMatchesPreference(seatId, preference))
    .map((seatId) => ({ seatId, seat: parseSeatId(seatId) }))
    .filter(
      (entry): entry is { seatId: string; seat: SeatCoordinates } =>
        entry.seat !== null,
    )
    .sort(
      (a, b) =>
        a.seat.row - b.seat.row || a.seat.column.localeCompare(b.seat.column),
    );
  return candidates[0]?.seatId ?? null;
}
