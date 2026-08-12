/**
 * BEAT 3b — the readables must describe the screen they are on, EXACTLY.
 * BEAT 3c — the levers must reach the rows AND the controls.
 *
 * `../readables.test.tsx` guards OMISSION: that a route readable and a per-page
 * readable exist at all. It reads source text, and source text is all a grep can
 * see. It cannot see the property the beat actually rests on — that the rows in
 * the readable ARE the rows the panel painted, in the order it painted them.
 *
 * That property is what fails silently. Commerce shipped a readable slicing 5
 * notifications against a panel rendering 6, so with six on screen the assistant
 * narrated five. Off by one is the version of wrong that survives a live demo
 * unnoticed, and it falsifies the beat's only claim — that the agent sees what
 * the presenter sees. Every assertion below therefore compares the readable's
 * list against the DOM, element for element and in order — never a count against
 * a count, because two counts can agree while the lists differ.
 *
 * The fixtures are deliberately LARGER than the seed (12 trips, 30 rebooking
 * options) so that any cap or truncation is exercised rather than sitting inert
 * behind a fixture too small to reach it.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type {
  BookingDto,
  Cabin,
  FareBrand,
  Flight,
  RebookingOption,
  Traveler,
} from "../data/trip-types";
import type { AirlineData } from "../data/types";

/** What the page most recently handed `useAgentContext`, raw. */
const readable = { value: "" };

/** The rebook page reads its five beat-3c levers off `useSearchParams`. */
const query = { value: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/airline/rebook",
  useSearchParams: () => new URLSearchParams(query.value),
}));

// `useSkinHref(skin.id)` is the real thing (unlocked → "/airline"); only the
// identity and the in-memory store it needs are stubbed, since no SkinProvider
// is mounted here.
const skinData = { value: null as AirlineData | null };
vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "airline" }),
  useSkinData: () => skinData.value,
}));

// The pages register readables. No shell provider is mounted in this tree, so
// record the value rather than dropping it. `useAgentContext` is the ONLY thing
// these pages use from the runtime.
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: ({ value }: { value: string }) => {
    readable.value = value;
  },
}));

// The two REST pages read the shared snapshot from `useAirlineLedger`, which
// THROWS outside its provider by design. Mocking the hook keeps the test on the
// thing under examination — the page's readable-versus-panel identity — and off
// the transport.
const ledger = {
  ready: true,
  now: "2026-07-14T15:20:00-04:00",
  profile: {
    accountName: "Camila Rojas",
    memberSince: "2014-03-19",
    paymentCardLabel: "Visa ending in ••••",
  },
  travelers: [] as Traveler[],
  flights: [] as Flight[],
  bookings: [] as BookingDto[],
  options: [] as RebookingOption[],
  exceptions: [],
  briefs: [],
  refresh: () => {},
};
vi.mock("../ledger-context", () => ({
  useAirlineLedger: () => ledger,
}));

import { TripsPage } from "./trips";
import { LoyaltyPage } from "./loyalty";
import { DisruptionsPage } from "./disruptions";
import { AccountPage } from "./account";
import { RebookPage } from "./rebook";

afterEach(() => {
  cleanup();
  readable.value = "";
  query.value = "";
  ledger.ready = true;
  ledger.travelers = [];
  ledger.flights = [];
  ledger.bookings = [];
  ledger.options = [];
  skinData.value = null;
});

/**
 * The readable the page just registered, parsed. Fails with the OMISSION
 * message rather than "Unexpected end of JSON input" when the page registered
 * nothing — the two failures have different fixes and should not look alike.
 */
const described = <T,>() => {
  expect(
    readable.value,
    "the page registered no readable at all (beat 3b, part 2)",
  ).not.toBe("");
  return JSON.parse(readable.value) as T;
};

const textOf = (el: Element | null | undefined) =>
  el?.textContent?.trim() ?? "";

/** Every `<td>` at index `col` of the page's single table, in the order shown. */
const renderedColumn = (col: number) =>
  Array.from(document.querySelectorAll("tbody tr")).map((tr) =>
    textOf(tr.children[col]),
  );

/**
 * The same, but located by COLUMN HEADING rather than by a magic index. The
 * option board grows a leading rank column whenever a sort lever is active, so a
 * fixed `0` would silently start reading ranks as flight numbers — a test that
 * then compares two lists of "1", "2", "3" and passes.
 */
const renderedColumnNamed = (heading: string) => {
  const col = Array.from(document.querySelectorAll("thead th")).findIndex(
    (th) => textOf(th) === heading,
  );
  expect(col, `no "${heading}" column is rendered`).toBeGreaterThanOrEqual(0);
  return renderedColumn(col);
};

// ── Fixtures ────────────────────────────────────────────────────────────────

const TRAVELERS: Traveler[] = [
  {
    id: "tv-camila",
    name: "Camila Rojas",
    memberId: "AN-4471902",
    tier: "gold",
    homeTimezone: "America/Santiago",
    accountHolder: true,
    relationship: "Account holder",
  },
  {
    id: "tv-tomas",
    name: "Tomás Aguirre",
    memberId: "AN-5518844",
    tier: "platinum",
    homeTimezone: "America/Santiago",
    accountHolder: false,
    relationship: "Partner",
  },
  {
    id: "tv-ines",
    name: "Inés Vidal",
    memberId: "AN-2290117",
    tier: "bronze",
    homeTimezone: "America/Santiago",
    accountHolder: false,
    relationship: "Mother",
  },
];

/** 12 trips across the three travellers — more than the seed's seven. */
const TRIP_COUNTS: Record<string, number> = {
  "tv-camila": 5,
  "tv-tomas": 4,
  "tv-ines": 3,
};

const flightFor = (i: number): Flight => ({
  id: `flt-${i}`,
  flightNumber: `AV${1000 + i}`,
  origin: "SCL",
  originCity: "Santiago",
  destination: "LIM",
  destinationCity: "Lima",
  // Descending departures, so `buildAccountTrips`' chronological sort has real
  // work to do and an unordered readable cannot accidentally agree with the DOM.
  departureLocal: `2026-07-${String(28 - i).padStart(2, "0")}T18:40:00-04:00`,
  arrivalLocal: `2026-07-${String(28 - i).padStart(2, "0")}T22:05:00-05:00`,
  aircraft: "Airbus A320neo",
  gate: "A17",
  status: "on_time",
  delayMinutes: 0,
  scheduleChangeMinutes: 0,
  availableSeats: [],
});

const bookingFor = (i: number, travelerId: string): BookingDto => ({
  id: `bkg-${i}`,
  reference: `AV${String(i).padStart(4, "0")}`,
  travelerId,
  flightId: `flt-${i}`,
  fare: {
    brand: "main",
    brandLabel: "Main Cabin",
    cabin: "economy",
    changeable: true,
    changeFeeUsd: 120,
    refundable: false,
  },
  farePaidUsd: 400 + i,
  seat: `1${i}C`,
  status: "ticketed",
  reissued: null,
  activeExceptionId: null,
  fareNotes: [`Note ${i}`],
  contacts: [],
  log: [],
  notices: [],
});

function seedAccount() {
  const flights: Flight[] = [];
  const bookings: BookingDto[] = [];
  let i = 0;
  for (const traveler of TRAVELERS) {
    for (let n = 0; n < TRIP_COUNTS[traveler.id]!; n += 1) {
      flights.push(flightFor(i));
      bookings.push(bookingFor(i, traveler.id));
      i += 1;
    }
  }
  ledger.travelers = TRAVELERS;
  ledger.flights = flights;
  ledger.bookings = bookings;
}

/**
 * 30 rebooking options on ONE cancelled booking, spread across three departure
 * windows, three stop buckets and three cabins — the shape `data/beat-map.md`
 * § "Beat 3c" requires, and fat enough that the beat's own lever set leaves a
 * board rather than a single row.
 */
const HOURS: Record<string, number> = {
  morning: 7,
  afternoon: 13,
  evening: 19,
};
const CABINS: Cabin[] = ["economy", "premium", "business"];
const BRANDS: FareBrand[] = ["basic", "main", "flex"];

function seedRebooking() {
  const flight: Flight = {
    ...flightFor(99),
    id: "flt-cancelled",
    flightNumber: "AV1466",
    origin: "LIM",
    originCity: "Lima",
    destination: "SCL",
    destinationCity: "Santiago",
    status: "cancelled",
  };
  const booking: BookingDto = {
    ...bookingFor(99, "tv-camila"),
    id: "bkg-cancelled",
    reference: "AV7QK2",
    flightId: "flt-cancelled",
  };
  // A SECOND rebookable trip, on an intact flight. Two things need it: the trip
  // picker only renders when there is a choice to make, and `pickDefaultBooking`
  // ranking cancelled above on-time is only a real assertion when there is
  // something for it to outrank.
  const intactFlight: Flight = { ...flightFor(98), id: "flt-intact" };
  const intactBooking: BookingDto = {
    ...bookingFor(98, "tv-camila"),
    id: "bkg-intact",
    reference: "AV6WQ8",
    flightId: "flt-intact",
  };
  ledger.travelers = TRAVELERS;
  // Intact FIRST in ledger order, so choosing the cancelled one cannot be an
  // accident of array position.
  ledger.flights = [intactFlight, flight];
  ledger.bookings = [intactBooking, booking];

  const options: RebookingOption[] = [];
  let n = 0;
  for (const windowName of ["morning", "afternoon", "evening"]) {
    for (const stops of [0, 1, 2]) {
      for (let c = 0; c < CABINS.length; c += 1) {
        // Distinct minutes per row so the price/duration comparators have a
        // strict order and a half-implemented sort cannot pass by luck.
        const hour = String(HOURS[windowName]! + (stops % 2)).padStart(2, "0");
        options.push({
          id: `o-${n}`,
          bookingId: "bkg-cancelled",
          flightNumber: `AV${2000 + n}`,
          origin: "LIM",
          destination: "SCL",
          departureLocal: `2026-07-21T${hour}:${String(10 + n).padStart(2, "0")}:00-05:00`,
          arrivalLocal: `2026-07-21T23:00:00-04:00`,
          durationMinutes: 600 - n * 7,
          stops,
          cabin: CABINS[c]!,
          fareBrand: BRANDS[c]!,
          fareDifferenceUsd: (n % 9) * 40 + c,
          seatsAvailable: 4 + (n % 6),
          operatedBy: "Aeronova",
          availableSeats: ["6C"],
        });
        n += 1;
      }
    }
  }
  // 27 from the grid, plus three more evening nonstops so the beat's own lever
  // set (evening + nonstop) admits comfortably more than the five it shows.
  for (let k = 0; k < 3; k += 1) {
    options.push({
      ...options[0]!,
      id: `o-extra-${k}`,
      flightNumber: `AV29${k}0`,
      departureLocal: `2026-07-21T2${k}:05:00-05:00`,
      stops: 0,
      cabin: "economy",
      fareBrand: "main",
      fareDifferenceUsd: 500 + k,
      durationMinutes: 300 + k,
    });
  }
  // Two options on the intact trip, so it counts as searchable and appears in
  // the picker. They must NOT reach the board: `optionsForBooking` scopes every
  // count and row to the selected booking, and `total` staying 30 below is what
  // proves it does.
  for (let k = 0; k < 2; k += 1) {
    options.push({
      ...options[0]!,
      id: `o-intact-${k}`,
      bookingId: "bkg-intact",
      flightNumber: `AV31${k}0`,
    });
  }
  ledger.options = options;
}

const airlineData = (): AirlineData => ({
  passenger: {
    name: "Camila Rojas",
    pnr: "AV7QK2",
    tier: "gold",
    member_id: "AN-4471902",
  },
  flight: {
    flight_number: "AV1423",
    origin: "SCL",
    origin_city: "Santiago",
    destination: "LIM",
    destination_city: "Lima",
    departure_time: "2026-07-14T18:40:00-04:00",
    arrival_time: "2026-07-14T22:05:00-05:00",
    aircraft: "Airbus A320neo",
    status: "delayed",
    gate: "A17",
  },
  seatMap: {
    flight_number: "AV1423",
    rows: 4,
    // Deliberately out of paint order (row 2 before row 1, column D before C)
    // so a readable that mapped the raw array rather than the map's own
    // ordering would disagree with the DOM.
    seats: [
      { id: "2D", row: 2, column: "D", status: "available" },
      { id: "2C", row: 2, column: "C", status: "occupied" },
      { id: "1C", row: 1, column: "C", status: "selected" },
      { id: "1A", row: 1, column: "A", status: "available" },
      { id: "3F", row: 3, column: "F", status: "blocked" },
      { id: "3A", row: 3, column: "A", status: "exit" },
      { id: "4B", row: 4, column: "B", status: "premium" },
    ],
    selected_seat_id: "1C",
  },
  boardingPass: null,
  loyalty: {
    member_name: "Camila Rojas",
    member_id: "AN-4471902",
    tier: "gold",
    miles: 62_400,
    miles_to_next_tier: 17_600,
    next_tier: "platinum",
    benefits: ["Priority boarding", "Two free bags"],
    segments_this_year: 22,
  },
  redemptions: Array.from({ length: 8 }, (_, i) => ({
    id: `r-${i}`,
    title: `Reward ${i}`,
    description: `Description ${i}`,
    miles_required: 1000 * (i + 1),
    category: "flight" as const,
    emoji: "✈️",
  })),
  disruption: {
    flight_number: "AV1423",
    type: "delay",
    severity: "warning",
    message: "AV1423 is running about 55 minutes late.",
    new_departure_time: "2026-07-14T19:35:00-04:00",
    new_gate: null,
  },
  rebookingOptions: Array.from({ length: 6 }, (_, i) => ({
    id: `rb-${i}`,
    flight_number: `AV${1500 + i}`,
    departure_time: "2026-07-14T20:00:00-04:00",
    arrival_time: "2026-07-14T23:20:00-05:00",
    duration: "3h 20m",
    stops: i % 2,
    price_difference: i * 25,
    seats_available: 3 + i,
  })),
  baggage: Array.from({ length: 3 }, (_, i) => ({
    tag_id: `AN-BAG-${i}`,
    status: "in_transit" as const,
    last_location: `Location ${i}`,
    last_updated: "2026-07-14T14:00:00-04:00",
    description: `Bag ${i}`,
  })),
  selectSeat: () => {},
  issueBoardingPass: () => null,
  chooseRebooking: () => null,
});

// ── The three in-memory pages ───────────────────────────────────────────────

describe("airline beat 3b — the in-memory pages describe their own screen", () => {
  it("Trip sends the selectable seats the map painted, in paint order", () => {
    skinData.value = airlineData();
    render(<TripsPage />);

    // The map's own buttons: enabled means selectable, and the label carries the
    // seat id. Occupied and blocked seats are disabled and must be absent.
    const onScreen = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Seat "]',
      ),
    )
      .filter((b) => !b.disabled)
      .map((b) => b.getAttribute("aria-label")!.split(" ")[1]);

    const value = described<{ page: string; open_seats: string[] }>();
    expect(value.page).toBe("Your trip");
    expect(value.open_seats).toEqual(onScreen);
    // Paint order is row-then-column, NOT the fixture's order — so this also
    // proves the readable follows the screen rather than the raw array.
    expect(value.open_seats).toEqual(["1A", "1C", "2D", "3A", "4B"]);
    expect(value.open_seats).not.toContain("2C"); // occupied
    expect(value.open_seats).not.toContain("3F"); // blocked
  });

  it("Aeronova Club sends the redemptions it renders, in the order shown", () => {
    skinData.value = airlineData();
    render(<LoyaltyPage />);

    const onScreen = Array.from(
      document.querySelectorAll("div.font-semibold.leading-tight.text-ink"),
    ).map(textOf);
    expect(onScreen).toHaveLength(8);

    const value = described<{
      page: string;
      visible: number;
      rows: { title: string }[];
    }>();
    expect(value.page).toBe("Aeronova Club");
    expect(value.rows.map((r) => r.title)).toEqual(onScreen);
    expect(value.visible).toBe(onScreen.length);
  });

  it("Disruptions sends the rebooking options and bags it renders, in order", () => {
    skinData.value = airlineData();
    render(<DisruptionsPage />);

    const flights = Array.from(document.querySelectorAll("div.w-16")).map(
      textOf,
    );
    expect(flights).toHaveLength(6);
    // The baggage tag shares every class of the option's flight cell except
    // `w-16`, which is why that one is excluded rather than the selector widened.
    const tags = Array.from(
      document.querySelectorAll(
        "div.font-mono.text-sm.font-semibold.text-ink:not(.w-16)",
      ),
    ).map(textOf);
    expect(tags).toHaveLength(3);

    const value = described<{
      page: string;
      visible: number;
      rows: { flight: string }[];
      baggage: { tag: string }[];
      disruption: { flight: string } | null;
    }>();
    expect(value.page).toBe("Disruptions & service");
    expect(value.rows.map((r) => r.flight)).toEqual(flights);
    expect(value.baggage.map((b) => b.tag)).toEqual(tags);
    expect(value.visible).toBe(flights.length);
    expect(value.disruption?.flight).toBe("AV1423");
  });

  it("the three in-memory pages do NOT answer identically", () => {
    // The whole beat: ask on one page, navigate, ask again, get two DIFFERENT
    // correct answers. Airline shipped only global readables before this slot,
    // so every page answered the same — which reads as working right up until
    // the presenter navigates.
    skinData.value = airlineData();
    render(<TripsPage />);
    const trip = readable.value;
    cleanup();
    render(<LoyaltyPage />);
    const loyalty = readable.value;
    cleanup();
    render(<DisruptionsPage />);
    const disruptions = readable.value;

    expect(new Set([trip, loyalty, disruptions]).size).toBe(3);
    expect(JSON.parse(trip).page).toBe("Your trip");
    expect(JSON.parse(loyalty).page).toBe("Aeronova Club");
    expect(JSON.parse(disruptions).page).toBe("Disruptions & service");
  });
});

// ── The account page, and the framing it must not lose ──────────────────────

/** Every trip row on the account page, in document order, by flight number. */
const renderedTripFlights = () =>
  Array.from(document.querySelectorAll("ul[aria-label] > li")).map((li) =>
    textOf(li.querySelector("span.font-mono.text-sm.font-semibold.text-ink")),
  );

interface AccountReadable {
  page: string;
  loading: boolean;
  visible: number;
  account: { holder: string; tier: string } | null;
  your_trips: { flight: string; confirmation: string }[];
  saved_travellers: {
    name: string;
    relationship: string;
    trips: { flight: string }[];
  }[];
}

describe("airline beat 3b — the account page", () => {
  it("sends the trips it renders, in document order, grouped as the page groups them", () => {
    seedAccount();
    render(<AccountPage />);

    const onScreen = renderedTripFlights();
    expect(onScreen).toHaveLength(12);

    const value = described<AccountReadable>();
    expect(value.page).toBe("Your account");
    // The readable's nesting flattened in reading order — account holder first,
    // then each saved traveller — must be exactly the document order.
    const flat = [
      ...value.your_trips.map((t) => t.flight),
      ...value.saved_travellers.flatMap((t) => t.trips.map((x) => x.flight)),
    ];
    expect(flat).toEqual(onScreen);
    expect(value.visible).toBe(onScreen.length);
  });

  it("orders each traveller's trips chronologically, as the list paints them", () => {
    seedAccount();
    render(<AccountPage />);

    const value = described<AccountReadable>();
    // The fixture's departures DESCEND, so a readable that ignored the sort
    // would still have five entries and this is the assertion that catches it.
    expect(value.your_trips.map((t) => t.flight)).toEqual([
      "AV1004",
      "AV1003",
      "AV1002",
      "AV1001",
      "AV1000",
    ]);
    expect(renderedTripFlights().slice(0, 5)).toEqual(
      value.your_trips.map((t) => t.flight),
    );
  });

  it("keeps the account visibly Camila's — holder named, companions nested by relationship", () => {
    // THE FRAMING GUARD. `data/beat-map.md` records that reframing Aeronova as
    // an operations desk was REJECTED, and names this page as where it would
    // creep back in. A flat table of three travellers is that reframe.
    seedAccount();
    render(<AccountPage />);

    const value = described<AccountReadable>();
    expect(value.account?.holder).toBe("Camila Rojas");
    // Her own trips are their own list, in the second person, and they are NOT
    // pooled with the companions'.
    expect(
      document.querySelector('ul[aria-label="Your trips"]'),
    ).not.toBeNull();
    expect(value.your_trips).toHaveLength(5);

    // The companions are saved travellers on HER account, each under their own
    // named list, described by their relationship to her.
    expect(value.saved_travellers.map((t) => t.name)).toEqual([
      "Tomás Aguirre",
      "Inés Vidal",
    ]);
    expect(value.saved_travellers.map((t) => t.relationship)).toEqual([
      "Partner",
      "Mother",
    ]);
    for (const name of ["Tomás Aguirre", "Inés Vidal"]) {
      expect(
        document.querySelector(`ul[aria-label="Trips booked for ${name}"]`),
        `${name} has no list of their own — the page has pooled the travellers`,
      ).not.toBeNull();
    }

    // And there is NO traveller column anywhere: a shared table with a person
    // per row is precisely the agency-console shape that was rejected.
    expect(document.querySelectorAll("table")).toHaveLength(0);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Your trips");
    expect(text).toContain("Saved travellers");
    expect(text).toContain("your partner");
    expect(text).toContain("your mother");
  });

  it("reports a screen that is still loading as loading, not as empty", () => {
    // Before the first read lands the ledger is legitimately empty. An agent
    // told "0 trips" about a screen that is still spinning describes it wrongly
    // with total confidence — the one failure mode this beat cannot survive.
    ledger.ready = false;
    render(<AccountPage />);

    const value = described<AccountReadable>();
    expect(value.loading).toBe(true);
    expect(value.visible).toBe(0);
    expect(document.body.textContent).toContain("Loading your account");
  });
});

// ── The rebooking search: beat 3c ───────────────────────────────────────────

interface RebookReadable {
  page: string;
  filters: {
    window: string | null;
    stops: string | null;
    cabin: string | null;
    sort: string | null;
    top: number | null;
  };
  total: number;
  matching: number;
  visible: number;
  rows: { flight: string; fare_difference_usd: number }[];
  trip: { confirmation: string; traveler: string } | null;
}

/** The class the page paints on a control it is actively applying. */
const ACTIVE = "bg-brand-soft";
const tinted = (label: string) => {
  const el = document.querySelector(`[aria-label="${label}"]`);
  expect(el, `no control labelled "${label}" is rendered`).not.toBeNull();
  return el!.className.includes(ACTIVE);
};

describe("airline beat 3c — the levers reach the rows and the controls", () => {
  it("opens on the trip that most needs rebooking, with the whole board", () => {
    seedRebooking();
    render(<RebookPage />);

    const value = described<RebookReadable>();
    expect(value.page).toBe("Rebooking search");
    expect(value.trip?.confirmation).toBe("AV7QK2");
    expect(value.trip?.traveler).toBe("Camila Rojas");
    expect(value.total).toBe(30);
    expect(value.matching).toBe(30);
    expect(value.rows.map((r) => r.flight)).toEqual(
      renderedColumnNamed("Flight"),
    );
    // Nothing was set, so nothing tints. A control lit with no lever behind it
    // tells the room the agent did something it did not.
    for (const label of [
      "Departure window",
      "Stops",
      "Cabin",
      "Sort order",
      "Result limit",
    ]) {
      expect(tinted(label), `${label} tints with no lever set`).toBe(false);
    }
  });

  it("applies all four levers plus the limit, and leaves a real board on screen", () => {
    // THE BEAT'S OWN LEVER SET. A one-row board is a FAILED beat — it is
    // indistinguishable on stage from a broken filter — so this asserts a floor
    // on what survives, not merely that the filters ran.
    seedRebooking();
    query.value =
      "window=evening&stops=nonstop&cabin=economy&sort=price_asc&top=5";
    render(<RebookPage />);

    const value = described<RebookReadable>();
    expect(value.filters).toEqual({
      window: "evening",
      stops: "nonstop",
      cabin: "economy",
      sort: "price_asc",
      top: 5,
    });
    expect(value.total).toBe(30);
    // Comfortably more than one row survives four simultaneous filters…
    expect(value.matching).toBeGreaterThanOrEqual(4);
    expect(value.matching).toBeLessThan(value.total);
    // …and the limit genuinely truncates what the room sees.
    expect(value.visible).toBe(Math.min(5, value.matching));

    const onScreen = renderedColumnNamed("Flight");
    expect(value.rows.map((r) => r.flight)).toEqual(onScreen);
    expect(onScreen).toHaveLength(value.visible);

    // Cheapest first, actually applied.
    const prices = value.rows.map((r) => r.fare_difference_usd);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);

    // ALL FIVE controls light up — the half of the beat that is easy to skip
    // and impossible to recover, because a filtered list alone asks the room to
    // take on faith that the assistant did it.
    for (const label of [
      "Departure window",
      "Stops",
      "Cabin",
      "Sort order",
      "Result limit",
    ]) {
      expect(tinted(label), `${label} did not tint under an active lever`).toBe(
        true,
      );
    }
    // The trip picker is the SUBJECT, not a lever, and must never tint.
    expect(tinted("Trip to rebook")).toBe(false);
  });

  it("prints a caption whose denominator is the FILTERED count", () => {
    // Commerce shipped "Top 10 of 22" from the whole book against 13 matching
    // rows: the single number the room is asked to read as proof of the maneuver
    // instead said the filters did nothing.
    seedRebooking();
    query.value = "window=evening&stops=nonstop&top=2";
    render(<RebookPage />);

    const value = described<RebookReadable>();
    expect(value.visible).toBe(2);
    expect(value.matching).toBeGreaterThan(2);
    expect(value.matching).toBeLessThan(30);
    expect(document.body.textContent).toContain(
      `Top 2 of ${value.matching} matching flights`,
    );
    // …and specifically NOT the unfiltered total.
    expect(document.body.textContent).not.toContain(`Top 2 of 30 matching`);
  });

  it("truncates to the FIRST N of the ordering, not N arbitrary rows", () => {
    seedRebooking();
    query.value = "sort=price_asc&top=6";
    render(<RebookPage />);
    const capped = renderedColumnNamed("Flight");
    expect(capped).toHaveLength(6);
    const value = described<RebookReadable>();
    expect(value.rows.map((r) => r.flight)).toEqual(capped);

    cleanup();
    readable.value = "";
    query.value = "sort=price_asc";
    render(<RebookPage />);
    expect(renderedColumnNamed("Flight").slice(0, 6)).toEqual(capped);
  });

  it("ranks the rows under a sort, and only under a sort", () => {
    seedRebooking();
    query.value = "sort=depart_soonest&top=4";
    render(<RebookPage />);
    // The rank column only exists under a sort, and it is column 0 — which is
    // why the flight lookup goes by heading rather than by index.
    expect(renderedColumn(0)).toEqual(["1", "2", "3", "4"]);

    cleanup();
    query.value = "top=4";
    render(<RebookPage />);
    expect(
      Array.from(document.querySelectorAll("thead th")).map(textOf),
    ).not.toContain("#");
  });

  it("ignores an unrecognised lever value rather than tinting a filter it is not applying", () => {
    seedRebooking();
    query.value = "sort=by_vibes&window=whenever&top=-3";
    render(<RebookPage />);

    const value = described<RebookReadable>();
    expect(value.filters.sort).toBeNull();
    expect(value.filters.window).toBeNull();
    // `parseTopLever` REFUSES rather than coerces: commerce turned `?top=-3`
    // into a one-row list, which on stage is indistinguishable from a
    // legitimately narrow filter result.
    expect(value.filters.top).toBeNull();
    expect(value.visible).toBe(30);
    expect(tinted("Sort order")).toBe(false);
    expect(tinted("Departure window")).toBe(false);
    expect(tinted("Result limit")).toBe(false);
  });

  it("answers differently from the account page", () => {
    // Beat 3b's actual claim, across the two REST-backed pages.
    seedRebooking();
    render(<RebookPage />);
    const rebook = readable.value;
    cleanup();
    readable.value = "";
    seedAccount();
    render(<AccountPage />);
    expect(readable.value).not.toBe(rebook);
    expect(JSON.parse(rebook).page).toBe("Rebooking search");
    expect(JSON.parse(readable.value).page).toBe("Your account");
  });
});
