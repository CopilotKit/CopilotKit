import { describe, it, expect } from "vitest";
import {
  NOTE_MARKER,
  NOTICE_TEMPLATES,
  NOTICE_TEMPLATE_LABELS,
  NOTIFY_PARTIES,
  NOTIFY_PARTY_LABELS,
  SEAT_PREFERENCES,
  SEAT_PREFERENCE_LABELS,
  columnKind,
  isNoticeTemplate,
  isNotifyParty,
  isSeatPreference,
  markNote,
  parseSeatId,
  pickSeatForPreference,
  seatMatchesPreference,
} from "./handling";

describe("the given vocabularies are labelled exhaustively", () => {
  it("labels every party, template and preference", () => {
    // An unlabelled member renders `undefined` in the human-facing menu.
    expect(Object.keys(NOTIFY_PARTY_LABELS).sort()).toEqual(
      [...NOTIFY_PARTIES].sort(),
    );
    expect(Object.keys(NOTICE_TEMPLATE_LABELS).sort()).toEqual(
      [...NOTICE_TEMPLATES].sort(),
    );
    expect(Object.keys(SEAT_PREFERENCE_LABELS).sort()).toEqual(
      [...SEAT_PREFERENCES].sort(),
    );
  });

  it("has predicates that agree with the tuples", () => {
    for (const party of NOTIFY_PARTIES) expect(isNotifyParty(party)).toBe(true);
    for (const t of NOTICE_TEMPLATES) expect(isNoticeTemplate(t)).toBe(true);
    for (const p of SEAT_PREFERENCES) expect(isSeatPreference(p)).toBe(true);
    expect(isNotifyParty("landlord")).toBe(false);
    expect(isNoticeTemplate("")).toBe(false);
    expect(isSeatPreference("bulkhead")).toBe(false);
  });
});

describe("markNote forces the marker", () => {
  it("prepends it, and does not double it", () => {
    // The marker is the affordance: "if the audience can't see the change, it
    // didn't happen." Forced server-side so no caller can phrase its way out.
    expect(markNote("Diego was told.")).toBe(`${NOTE_MARKER} Diego was told.`);
    expect(markNote(`${NOTE_MARKER} already marked`)).toBe(
      `${NOTE_MARKER} already marked`,
    );
    expect(markNote("  padded  ")).toBe(`${NOTE_MARKER} padded`);
  });
});

describe("seat geometry", () => {
  it("parses a seat id and refuses what is not one", () => {
    expect(parseSeatId("14C")).toEqual({ row: 14, column: "C" });
    expect(parseSeatId(" 7d ")).toEqual({ row: 7, column: "D" });
    expect(parseSeatId("C14")).toBeNull();
    expect(parseSeatId("14G")).toBeNull();
    expect(parseSeatId("0A")).toBeNull();
    expect(parseSeatId("")).toBeNull();
  });

  it("classifies columns", () => {
    expect(columnKind("A")).toBe("window");
    expect(columnKind("F")).toBe("window");
    expect(columnKind("C")).toBe("aisle");
    expect(columnKind("D")).toBe("aisle");
    expect(columnKind("B")).toBe("middle");
    expect(columnKind("e")).toBe("middle");
  });

  it("matches preferences, and matches none for an unreadable seat", () => {
    expect(seatMatchesPreference("14C", "aisle")).toBe(true);
    expect(seatMatchesPreference("14A", "window")).toBe(true);
    expect(seatMatchesPreference("6C", "forward-cabin")).toBe(true);
    expect(seatMatchesPreference("9C", "forward-cabin")).toBe(false);
    expect(seatMatchesPreference("12D", "exit-row")).toBe(true);
    for (const preference of SEAT_PREFERENCES) {
      expect(seatMatchesPreference("nope", preference)).toBe(false);
    }
  });
});

describe("pickSeatForPreference", () => {
  const pool = ["18F", "9C", "6C", "12D", "9A", "20C"];

  it("takes the most forward match, then the lowest column", () => {
    expect(pickSeatForPreference(pool, "aisle")).toBe("6C");
    expect(pickSeatForPreference(pool, "window")).toBe("9A");
    expect(pickSeatForPreference(pool, "exit-row")).toBe("12D");
    expect(pickSeatForPreference(pool, "forward-cabin")).toBe("6C");
  });

  it("REFUSES rather than approximating when nothing matches", () => {
    // A reseat that quietly lands the passenger in a middle seat and reports
    // success is exactly the confident falsehood this app fails toward.
    expect(pickSeatForPreference(["11B", "14E"], "aisle")).toBeNull();
    expect(pickSeatForPreference([], "window")).toBeNull();
  });

  it("ignores junk in the pool instead of returning it", () => {
    expect(pickSeatForPreference(["", "seat", "9C"], "aisle")).toBe("9C");
  });
});
