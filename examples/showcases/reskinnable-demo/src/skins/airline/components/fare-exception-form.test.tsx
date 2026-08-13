/**
 * BEAT 6 — the passenger filing form's RECORDING contract, and its ASYMMETRY.
 *
 * The shell's `recording.test.tsx` proves the state machine in isolation and
 * `../teach-mode-directives.test.ts` proves the directives. Neither can prove the
 * thing that actually breaks here: that THIS form calls into the recorder in the
 * right order, and that the category it files is the one `getDemonstratedCode()`
 * hands to the chat. Every failure mode is silent — `logStep` early-returns while
 * idle, `useRecording` returns inert no-ops outside a provider — so a broken form
 * still renders, still files, and is discovered on stage with an empty feed and no
 * category.
 *
 * The outer bracket is simulated deliberately. In the app the chat's
 * `DemonstrationCard` holds `beginRecording()` open from "show me" to "I'm done";
 * the form's own brackets nest inside it. That nesting is what keeps the feed alive
 * across the TWO clicks a demonstration takes (file, then retry), so the test opens
 * an outer bracket the same way rather than relying on the shell's minimum-visible
 * hold to paper over a gap.
 *
 * THE FIXTURES ARE THE REAL SEED, with `waiverGround` stripped exactly as
 * `store.snapshot()` strips it. Hand-rolled bookings would let this suite pass
 * against a form that only works on shapes no route ever publishes — and the
 * stripping is itself the sixth leak channel, so the client half must be exercised
 * against the wire shape.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { RecordingProvider, useRecording } from "@/shell/teach";
import { toDto } from "../data/store";
import { seedBookings, seedFlights, seedOptions } from "../data/trip-seed";
import type { AirlineLedgerValue } from "../ledger-context";

const ledger = { current: null as AirlineLedgerValue | null };
const notify = vi.fn();
vi.mock("../ledger-context", () => ({
  useAirlineLedger: () => ledger.current,
  notifyAirlineDataChanged: () => notify(),
}));

import { FareExceptionForm } from "./fare-exception-form";

/**
 * The wire shape: every booking put through the REAL stripper the ledger route
 * uses, rather than a rest destructure here. Two reasons — a hand-stripped fixture
 * would drift the day `Booking` grows a field, and `toDto` IS the mechanism that
 * closes airline's sixth leak channel, so exercising it is the point.
 */
const dtos = seedBookings.map(toDto);

function makeLedger(overrides: Partial<AirlineLedgerValue> = {}) {
  return {
    now: "2026-07-14T15:20:00-04:00",
    profile: null,
    travelers: [],
    flights: seedFlights,
    bookings: dtos,
    options: seedOptions,
    exceptions: [],
    briefs: [],
    ready: true,
    refresh: () => {},
    ...overrides,
  } as AirlineLedgerValue;
}

/**
 * Stands in for the chat's `DemonstrationCard`: opens the outer bracket on mount
 * and reports the live feed plus the derived category out to the assertions.
 */
function Recorder({
  report,
}: {
  report: (state: { labels: string[]; code: string | null }) => void;
}) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();
  useEffect(() => {
    beginRecording();
    return () => endRecording();
  }, [beginRecording, endRecording]);
  report({ labels: steps.map((s) => s.label), code: getDemonstratedCode() });
  return null;
}

const mount = () => {
  let state = { labels: [] as string[], code: null as string | null };
  render(
    <RecordingProvider>
      <Recorder report={(s) => (state = s)} />
      <FareExceptionForm />
    </RecordingProvider>,
  );
  return () => state;
};

const pickBooking = (bookingId: string) =>
  fireEvent.change(screen.getByLabelText("Booking refused by its fare"), {
    target: { value: bookingId },
  });

const pickCategory = (code: string) =>
  fireEvent.change(screen.getByLabelText("Fare exception category"), {
    target: { value: code },
  });

const typeDocumentation = (text: string) =>
  fireEvent.change(
    screen.getByLabelText("Documentation behind the exception"),
    { target: { value: text } },
  );

/** Queue of responses the mocked fetch hands back, in call order. */
let responses: Response[] = [];
/**
 * Typed by DERIVING the spy's own return type rather than writing
 * `ReturnType<typeof vi.spyOn>`: that generic-free form widens the call signature
 * to `(...args: unknown[])`, which `tsc` rejects against the real `fetch` overloads
 * (TS2322) — and naming the key explicitly fails too, because `fetch` is not in
 * this config's `keyof typeof globalThis`. Deriving keeps `mock.calls` correctly
 * typed for `posted()`.
 */
const spyOnFetch = () => vi.spyOn(globalThis, "fetch");
let fetchMock: ReturnType<typeof spyOnFetch>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  ledger.current = makeLedger();
  responses = [];
  fetchMock = spyOnFetch().mockImplementation(() =>
    Promise.resolve(responses.shift() ?? json({}, 500)),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  notify.mockReset();
  ledger.current = null;
});

/** The bodies of the POSTs the form made, paired with their paths. */
const posted = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: String(url),
    body: JSON.parse(String((init as RequestInit).body ?? "{}")) as Record<
      string,
      unknown
    >,
  }));

describe("airline beat 6 — the passenger filing form", () => {
  it("offers only the bookings the fare rules actually refuse", () => {
    mount();
    // DERIVED from the same clause order the server runs, so the form can never
    // advertise a booking the gate would permit — nor hide one it would refuse.
    // Three are seeded: AV3PL9 (schedule change), AV8RT4 (medical), AV5KD1
    // (nothing on file, released by no category at all).
    const select = screen.getByLabelText(
      "Booking refused by its fare",
    ) as HTMLSelectElement;
    const offered = [...select.options].map((o) => o.textContent ?? "");
    expect(offered).toHaveLength(3);
    expect(offered.join(" | ")).toContain("AV3PL9");
    expect(offered.join(" | ")).toContain("AV8RT4");
    expect(offered.join(" | ")).toContain("AV5KD1");
    // The Flex booking is permitted and the cancelled one is involuntary — neither
    // belongs on a filing form.
    expect(offered.join(" | ")).not.toContain("AV6WQ8");
    expect(offered.join(" | ")).not.toContain("AV7QK2");
  });

  it("lists justifying categories and decoys TOGETHER, unmarked, in catalogue order", () => {
    mount();
    // A form that flagged the working ones would turn the demonstration into a
    // guided tour: the passenger would be following an instruction the app gave
    // them, not exercising knowledge only they have.
    const select = screen.getByLabelText(
      "Fare exception category",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "SCHEDULE_CHANGE_TRIGGERED",
      "CHANGED_PLANS",
      "MEDICAL_DOCUMENTED",
      "FOUND_LOWER_FARE",
      "BEREAVEMENT_DOCUMENTED",
      "ELITE_COURTESY",
      "MILITARY_ORDERS",
    ]);
  });

  it("shows what the selected booking DOCUMENTS, which is the input to the procedure", () => {
    mount();
    // The learned procedure is "read what the booking documents, file the category
    // that matches it". This prose is where the passenger reads that — and it is
    // deliberately free of catalogue vocabulary, which is why it may be on screen
    // and in the agent's readables at once.
    pickBooking("bkg-av2214");
    expect(screen.getByText(/notice AV-88214 is on file/)).toBeTruthy();
    pickBooking("bkg-av0918");
    expect(screen.getByText(/physician's certificate/)).toBeTruthy();
    pickBooking("bkg-av1188");
    expect(screen.getByText(/Nothing is on file/)).toBeTruthy();
  });

  it("records the filed category as DATA on the step that files it", async () => {
    const state = mount();
    pickCategory("SCHEDULE_CHANGE_TRIGGERED");
    typeDocumentation("notice AV-88214");
    responses = [json({ exception: { id: "exc-1" } }, 201), json({ ok: true })];

    fireEvent.click(
      screen.getByRole("button", { name: "File fare exception" }),
    );

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the fare exception form on AV3PL9",
        "Filed the fare exception as SCHEDULE_CHANGE_TRIGGERED",
      ]),
    );
    // The whole hand-off to the chat: `getDemonstratedCode()` reads the last CODED
    // step, so the filing step must carry the category rather than merely mention
    // it in prose.
    expect(state().code).toBe("SCHEDULE_CHANGE_TRIGGERED");
    // Filed AND approved — two calls, because there is no review step in the demo.
    expect(posted().map((p) => p.path)).toEqual([
      "/api/airline/v1/fare-exceptions",
      "/api/airline/v1/fare-exceptions/exc-1/approve",
    ]);
    expect(posted()[0].body).toMatchObject({
      booking: "bkg-av2214",
      code: "SCHEDULE_CHANGE_TRIGGERED",
      documentReference: "notice AV-88214",
    });
  });

  it("records the DECOY the passenger actually filed, not a corrected one", async () => {
    // A recorder that quietly substituted a working category would report a
    // procedure nobody demonstrated — and the retry below would still be refused,
    // so the transcript and the app would disagree on stage.
    const state = mount();
    pickCategory("CHANGED_PLANS");
    typeDocumentation("I changed my mind");
    responses = [json({ exception: { id: "exc-2" } }, 201), json({ ok: true })];

    fireEvent.click(
      screen.getByRole("button", { name: "File fare exception" }),
    );
    await waitFor(() => expect(state().code).toBe("CHANGED_PLANS"));

    responses = [
      json(
        {
          error: "FARE_NOT_CHANGEABLE",
          message:
            "AV3PL9 is ticketed in Basic Economy. Changes are not permitted on this fare.",
        },
        422,
      ),
    ];
    fireEvent.click(screen.getByRole("button", { name: /^Retry the reissue/ }));

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the fare exception form on AV3PL9",
        "Filed the fare exception as CHANGED_PLANS",
        "Re-attempted the reissue on AV3PL9 — still refused",
      ]),
    );
    // Still the filed category: the demonstration is what it is, and the chat card
    // must be able to report the decoy the passenger chose.
    expect(state().code).toBe("CHANGED_PLANS");
    // The server's own refusal, surfaced on the note line rather than swallowed.
    expect(document.querySelector("p.text-negative")?.textContent).toContain(
      "Changes are not permitted on this fare",
    );
  });

  it("keeps ONE continuous feed across the file and retry clicks", async () => {
    // The two clicks are two nested brackets. If the outer one were missing the ref
    // count would touch zero between them; the shell's minimum-visible hold hides
    // that most of the time and would not on a slow stage machine.
    const state = mount();
    pickCategory("SCHEDULE_CHANGE_TRIGGERED");
    typeDocumentation("notice AV-88214");
    responses = [json({ exception: { id: "exc-3" } }, 201), json({ ok: true })];
    fireEvent.click(
      screen.getByRole("button", { name: "File fare exception" }),
    );
    await waitFor(() => expect(state().labels).toHaveLength(2));

    responses = [json({ reissue: { flightNumber: "AV2216" } })];
    fireEvent.click(screen.getByRole("button", { name: /^Retry the reissue/ }));

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the fare exception form on AV3PL9",
        "Filed the fare exception as SCHEDULE_CHANGE_TRIGGERED",
        "Reissued AV3PL9 onto AV2216 — the refusal lifted",
      ]),
    );
    expect(state().code).toBe("SCHEDULE_CHANGE_TRIGGERED");
    // The cheapest option by fare difference — $0 on `o-2214-a` — so the retry is
    // not derailed by a 402 the demo never mentions.
    expect(posted().at(-1)).toMatchObject({
      path: "/api/airline/v1/bookings/bkg-av2214/change",
      body: { optionId: "o-2214-a" },
    });
    // …and the screen is told to re-read the ledger, or the trip record on stage
    // still shows the pre-write itinerary.
    expect(notify).toHaveBeenCalled();
  });

  it("refuses a filing with nothing behind it, and NARRATES the refusal", async () => {
    // Refused before the request: the route's own MISSING_DOCUMENTATION answer
    // would read on stage as the gate speaking when it is really an empty text box.
    // Narrated so the agent sees the attempt happened and failed — silence would
    // let it conclude the step succeeded.
    const state = mount();
    pickCategory("SCHEDULE_CHANGE_TRIGGERED");

    fireEvent.click(
      screen.getByRole("button", { name: "File fare exception" }),
    );

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the fare exception form on AV3PL9",
        "The filing on AV3PL9 had nothing behind it",
      ]),
    );
    expect(state().code).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // The retry stays locked until something is actually on file.
    expect(
      screen
        .getByRole("button", { name: /^Retry the reissue/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("narrates a refused filing instead of failing silently", async () => {
    const state = mount();
    typeDocumentation("something");
    responses = [
      json(
        {
          error: "INVALID_EXCEPTION_CODE",
          message: "That is not a recognised fare exception category.",
        },
        422,
      ),
    ];

    fireEvent.click(
      screen.getByRole("button", { name: "File fare exception" }),
    );

    await waitFor(() =>
      expect(state().labels).toEqual([
        "Opened the fare exception form on AV3PL9",
        "The fare exception was refused on AV3PL9",
      ]),
    );
    // No coded step, so nothing is handed to the chat as "the category that worked".
    expect(state().code).toBeNull();
    // And the refusal names no categories — the 4xx body is a leak channel.
    expect(document.querySelector("p.text-negative")?.textContent).toBe(
      "That is not a recognised fare exception category.",
    );
  });

  it("keeps the filed case selectable after it drops off the blocked list", async () => {
    // THE NORMAL PATH, not an edge case: once an approved exception is linked, the
    // client's optimistic `blockedByFare` stops listing the booking — even when the
    // category was a decoy the server will still refuse. Losing the selection here
    // would make the presenter hunt for the case they just filed against, mid-demo.
    const state = mount();
    pickCategory("MEDICAL_DOCUMENTED");
    typeDocumentation("certificate");
    responses = [json({ exception: { id: "exc-4" } }, 201), json({ ok: true })];
    fireEvent.click(
      screen.getByRole("button", { name: "File fare exception" }),
    );
    await waitFor(() => expect(state().code).toBe("MEDICAL_DOCUMENTED"));

    // The route linked and approved it; simulate the ledger re-read.
    ledger.current = makeLedger({
      bookings: dtos.map((b) =>
        b.id === "bkg-av2214" ? { ...b, activeExceptionId: "exc-4" } : b,
      ),
      exceptions: [
        {
          id: "exc-4",
          bookingId: "bkg-av2214",
          code: "MEDICAL_DOCUMENTED",
          documentReference: "certificate",
          rationale: "",
          status: "approved",
          createdAt: "2026-07-14T15:20:00-04:00",
        },
      ],
    });
    fireEvent.change(
      screen.getByLabelText("Documentation behind the exception"),
      {
        target: { value: "certificate" },
      },
    );

    const select = screen.getByLabelText(
      "Booking refused by its fare",
    ) as HTMLSelectElement;
    expect(select.value).toBe("bkg-av2214");
    expect([...select.options].map((o) => o.value)).toContain("bkg-av2214");
    expect(
      screen
        .getByRole("button", { name: /^Retry the reissue/ })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers no filing surface when nothing is refused by its fare", () => {
    ledger.current = makeLedger({
      bookings: dtos.filter((b) => b.fare.changeable),
    });
    mount();
    expect(screen.queryByLabelText("Fare exception category")).toBeNull();
    expect(screen.getByText(/Nothing on your account is refused/)).toBeTruthy();
  });

  it("says it is still LOADING rather than reporting an empty account", () => {
    // Before the first `GET /ledger` settles the list is legitimately empty, and
    // "nothing is refused" would be a confident lie about a spinning screen.
    ledger.current = makeLedger({ bookings: [], ready: false });
    mount();
    expect(screen.getByText(/Checking which of your tickets/)).toBeTruthy();
  });
});
