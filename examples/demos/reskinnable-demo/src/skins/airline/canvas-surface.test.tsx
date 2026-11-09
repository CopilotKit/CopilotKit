import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The canvas reads its surface out of `agent.messages`; serve a mutable ref so a
// test can advance the stream.
const { messagesRef } = vi.hoisted(() => ({
  messagesRef: { current: [] as unknown[] },
}));
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: { messages: messagesRef.current } }),
}));

// Imported after the mock so they bind the stubbed module.
import { AirlineCanvasSurface } from "./canvas-surface";
import { airlineCatalog } from "./catalog";
import {
  A2UI_OPERATIONS_KEY,
  buildTripBriefOps,
  TRIP_BRIEF_CATALOG_ID,
} from "./canvas/trip-brief-ops";
import { TRIP_BRIEFS_URL } from "./canvas/use-trip-briefs";
import * as store from "./data/store";
import { HOTEL_CONFIRMATIONS } from "./data/hotel-confirmations";
import { POST as fileBrief } from "@/app/api/airline/v1/briefs/route";
import type { TripBrief } from "./data/trip-types";

/**
 * BEAT 3d — what the room actually sees at the end of the maneuver.
 *
 * Driven end to end against the REAL substrate rather than a fixture brief: the
 * document facts go through `POST /api/airline/v1/briefs`, the server settles the
 * ledger half, and the canvas renders what `GET /briefs` gives back. A
 * hand-written brief object would let this file pass while the two halves
 * disagreed about the field names — which is the whole thing the split exists to
 * get right.
 */

/** Exactly what a model that READ the seeded Lima confirmation would send. */
const asRead = (over: Record<string, unknown> = {}) => {
  const entry = HOTEL_CONFIRMATIONS[0];
  return {
    hotelName: entry.hotelName,
    confirmationNumber: entry.confirmationNumber,
    address: entry.address,
    lastCheckInLocal: entry.lastCheckInLocal,
    cancellationDeadlineLocal: entry.cancellationDeadlineLocal,
    nightlyRateUsd: entry.nightlyRateUsd,
    guestName: entry.guestName,
    city: entry.city,
    checkInDate: entry.checkInDate,
    ...over,
  };
};

async function fileTheBrief(
  body: Record<string, unknown> = asRead(),
): Promise<TripBrief> {
  const res = await fileBrief(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()).brief as TripBrief;
}

/** The canvas's only read: the filed briefs, straight off the store. */
function serveFiledBriefs() {
  const fetchSpy = vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ briefs: store.briefs() }),
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

/** The activity the `render_trip_brief` server tool produces. */
function openCanvasOn(briefId: string | null, activityId = "act-1") {
  messagesRef.current = [
    {
      id: activityId,
      role: "activity",
      activityType: "a2ui-surface",
      content: { [A2UI_OPERATIONS_KEY]: buildTripBriefOps(briefId) },
    },
  ];
}

beforeEach(() => {
  store.reset();
  messagesRef.current = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the trip brief on the canvas", () => {
  it("cites the fact only the DOCUMENT could supply, alongside the one only the LEDGER could", async () => {
    // This is the beat. The confirmation number and the desk's cutoff exist
    // nowhere in Aeronova's world; the flight number and its delayed arrival
    // exist nowhere in the hotel's (`data/hotel-confirmation-pdf.test.ts` pins
    // that half — the document names no flight at all). A brief that could have
    // been assembled from either side alone proves nothing.
    const brief = await fileTheBrief();

    // The ledger, with the filed briefs taken back out: this is everything the
    // app knew BEFORE the attachment was read.
    const ledgerWithoutBriefs = JSON.stringify({
      ...store.snapshot(),
      briefs: [],
    });
    expect(ledgerWithoutBriefs).not.toContain("CM-77Q4132");

    serveFiledBriefs();
    openCanvasOn(brief.id);
    render(<AirlineCanvasSurface />);

    const headline = await screen.findByTestId("trip-brief-headline");
    const text = headline.textContent ?? "";
    // Only the document knows the desk closes at 22:30…
    expect(text).toContain("22:30");
    // …and only the ledger knows which flight lands, and when, once today's
    // 55-minute delay is applied.
    expect(text).toContain("AV1423");
    expect(text).toContain("23:00");
    expect(headline.getAttribute("data-collides")).toBe("true");

    // The document-only fields are on screen, not just in the sentence.
    expect(screen.getByText("CM-77Q4132")).toBeTruthy();
    // …as are the ledger-settled ones.
    expect(screen.getByText("AV7QK2")).toBeTruthy();
    expect(screen.getByText("LIM")).toBeTruthy();
  });

  it("renders the FILED artifact, read back off the app", async () => {
    // Not a replay of the run: the canvas fetches the trip record, which is what
    // makes "delete the conversation and it is still there" true on screen.
    const brief = await fileTheBrief();
    const fetchSpy = serveFiledBriefs();
    openCanvasOn(brief.id);
    render(<AirlineCanvasSurface />);

    await screen.findByTestId("trip-brief-headline");
    expect(fetchSpy).toHaveBeenCalledWith(TRIP_BRIEFS_URL);
    // Nothing on the canvas came out of the operations.
    expect(JSON.stringify(messagesRef.current)).not.toContain(
      "Casa Miraflores",
    );
  });

  it("shows the UNCHECKED banner, never the reassuring one, when nothing matched", async () => {
    // Tri-state or bust: `arrivesAfterLastCheckIn === null` means the comparison
    // could not be made. A green banner here would be the app telling the room
    // "checked, and fine" about something nobody checked.
    const brief = await fileTheBrief(asRead({ guestName: "Nobody At All" }));
    expect(brief.arrivesAfterLastCheckIn).toBeNull();

    serveFiledBriefs();
    openCanvasOn(brief.id);
    render(<AirlineCanvasSurface />);

    const headline = await screen.findByTestId("trip-brief-headline");
    expect(headline.getAttribute("data-collides")).toBe("unknown");
    // The dropped ledger fields print as an absence the server reached, not as
    // blank cells.
    expect(screen.getAllByText("not on file").length).toBeGreaterThan(0);
  });
});

describe("every state says something", () => {
  it("refuses to fall through to a different brief when the named one is missing", async () => {
    // Showing the newest brief under THIS run's headline is worse than showing
    // none: the room would read last week's hotel as this run's answer.
    await fileTheBrief();
    serveFiledBriefs();
    openCanvasOn("tb-does-not-exist");
    render(<AirlineCanvasSurface />);

    expect(await screen.findByText(/not on the trip record/)).toBeTruthy();
    expect(screen.queryByTestId("trip-brief-headline")).toBeNull();
  });

  it("says so when nothing has been filed", async () => {
    serveFiledBriefs();
    openCanvasOn(null);
    render(<AirlineCanvasSurface />);

    expect(
      await screen.findByText(/No trip brief has been filed yet/),
    ).toBeTruthy();
  });

  it("reports a failed read rather than rendering an empty region", async () => {
    // A blank canvas is indistinguishable from a write that silently failed, and
    // the presenter has nothing to say about it.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );
    openCanvasOn(null);
    render(<AirlineCanvasSurface />);

    expect(
      await screen.findByText(/Could not read the filed trip briefs/),
    ).toBeTruthy();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("the trigger contract", () => {
  it("opens the surface against the catalog the skin actually registers", () => {
    // `trip-brief-ops.ts` restates this id rather than importing it, because it
    // is server-safe and `catalog/index.tsx` is `"use client"` JSX. This is the
    // drift guard between the two copies.
    expect(airlineCatalog.id).toBe(TRIP_BRIEF_CATALOG_ID);
  });

  it("opens on the loading notice, never on a blank region", async () => {
    // The shell only mounts a CanvasSurface once a surface activity is in the
    // stream, but the component must not assume one: `messages: []` is what the
    // very first render of a fresh thread sees, and the read is in flight then.
    serveFiledBriefs();
    messagesRef.current = [];
    render(<AirlineCanvasSurface />);

    expect(screen.getByText(/Reading the filed trip briefs/)).toBeTruthy();
    // Settle the fetch before the test ends, so the state update lands inside
    // it rather than leaking an act() warning into the next one.
    await screen.findByText(/No trip brief has been filed yet/);
  });
});
