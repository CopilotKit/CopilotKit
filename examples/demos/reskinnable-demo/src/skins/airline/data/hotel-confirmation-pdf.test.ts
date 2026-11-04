import { describe, it, expect } from "vitest";
import {
  HOTEL_CONFIRMATION_METRICS,
  arrivalLines,
  buildHotelConfirmationPdf,
  cancellationLines,
  stayTotalUsd,
} from "./hotel-confirmation-pdf";
import { HOTEL_CONFIRMATIONS } from "./hotel-confirmations";
import type { HotelConfirmationEntry } from "./hotel-confirmations";

const entry = (over: Partial<HotelConfirmationEntry> = {}) => ({
  ...HOTEL_CONFIRMATIONS[0],
  ...over,
});

describe("every sentence is derived from the entry's own rows", () => {
  it("computes the total rather than carrying one", () => {
    expect(stayTotalUsd(entry({ nightlyRateUsd: 148, nights: 3 }))).toBe(444);
  });

  it("quotes the hotel's own last check-in in both arrival sentences", () => {
    const lines = arrivalLines(entry({ lastCheckInLocal: "21:15" }));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.includes("21:15"))).toBe(true);
  });

  it("names the penalty the entry actually implies, not a fixed one", () => {
    // A hardcoded "the first night is charged" would have been wrong on one of
    // the two seeded rows. The agent lifts these sentences out and narrates
    // them, so a claim the numbers contradict is asserted to the room.
    const prepaid = cancellationLines(
      entry({ prepaid: true, nightlyRateUsd: 148, nights: 3 }),
    ).join(" ");
    expect(prepaid).toContain("$444.00");
    expect(prepaid).toContain("non-refundable");

    const onArrival = cancellationLines(
      entry({ prepaid: false, nightlyRateUsd: 212, nights: 2 }),
    ).join(" ");
    expect(onArrival).toContain("$212.00");
    expect(onArrival).toContain("first night");
  });

  it("quotes the deadline and the check-in date it belongs to", () => {
    const line = cancellationLines(
      entry({ cancellationDeadlineLocal: "16:00", checkInDate: "2026-08-13" }),
    )[0];
    expect(line).toContain("16:00");
    expect(line).toContain("2026-08-13");
  });
});

describe("the document must not know the flight", () => {
  it("names no flight, no airline and no arrival time", () => {
    // ⚠️ The whole proof of beat 3d is that the brief's headline — "lands 23:00,
    // desk closes 22:30" — cannot be derived from either source alone. Print an
    // arrival time here and the beat quietly stops proving anything.
    for (const row of HOTEL_CONFIRMATIONS) {
      const text = new TextDecoder("latin1").decode(
        buildHotelConfirmationPdf(row),
      );
      expect(text).not.toContain("Aeronova");
      expect(text).not.toMatch(/AV\d{3,4}/);
      expect(text.toLowerCase()).not.toContain("flight");
      expect(text.toLowerCase()).not.toContain("arrival time");
    }
  });
});

describe("byte-level invariants", () => {
  it("emits pure ASCII even from accented content", () => {
    // `Camila Rojas`, `Tomás Aguirre`, `Inés Vidal` and `Calle Berlín 424` all
    // reach this document. A base-14 font is one byte per glyph while
    // `TextEncoder` is UTF-8, so an unfolded accent is mojibake AND a `/Length`
    // that disagrees with the bytes.
    const pdf = buildHotelConfirmationPdf(
      entry({
        guestName: "Tomás Aguirre",
        address: "Calle Berlín 424 — “Miraflores”",
        hotelName: "Hôtel Inés",
      }),
    );
    expect([...pdf].every((byte) => byte < 0x80)).toBe(true);
  });

  it("starts with a PDF header", () => {
    // `stageAttachment` checks the same bytes; a 200 that is not a PDF is one of
    // the nine ways beat 3d's chain breaks.
    const pdf = buildHotelConfirmationPdf(entry());
    expect(new TextDecoder("latin1").decode(pdf.slice(0, 5))).toBe("%PDF-");
  });
});

describe("the stay table's alignment contract", () => {
  it("fits inside the page's drawable width", () => {
    // The columns are aligned by CHARACTER COUNT, which is only true alignment
    // in a monospaced font — so the row must also FIT, or it runs off the page
    // while the shell's own suite stays green.
    const { columns, bodySize, monoAdvance, drawableWidth } =
      HOTEL_CONFIRMATION_METRICS;
    const longestValue = Math.max(
      ...HOTEL_CONFIRMATIONS.flatMap((row) => [
        row.guestName.length,
        row.confirmationNumber.length,
        row.checkInDate.length,
      ]),
    );
    const widthPt =
      (columns.label + Math.max(columns.value, longestValue)) *
      monoAdvance *
      bodySize;
    expect(widthPt).toBeLessThanOrEqual(drawableWidth);
  });

  it("actually DRAWS the table in Courier and the prose in Helvetica", () => {
    // Asserted on the emitted `Tf` operators, not on the font dictionary: the
    // dictionary declares all four base-14 fonts whether or not a line uses one,
    // so `toContain("/F3")` would stay green with `mono` deleted from every row
    // — and the table would render visibly ragged with nothing to catch it.
    const text = new TextDecoder("latin1").decode(
      buildHotelConfirmationPdf(entry()),
    );
    const fonts = [...text.matchAll(/\/(F[1-4]) [0-9.]+ Tf/g)].map((m) => m[1]);
    // F3/F4 are Courier and Courier-Bold; F1/F2 are Helvetica and its bold.
    expect(
      fonts.filter((f) => f === "F3" || f === "F4").length,
    ).toBeGreaterThan(5);
    expect(
      fonts.filter((f) => f === "F1" || f === "F2").length,
    ).toBeGreaterThan(3);
  });
});
