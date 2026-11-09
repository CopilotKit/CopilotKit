import type {
  BaggageItem,
  DisruptionAlert,
  Flight,
  LoyaltyStatus,
  Passenger,
  RebookingOption,
  RedemptionOption,
  Seat,
  SeatMap,
} from "./types";

// A single coherent trip: Camila is flying Aeronova AV1423 SCL → LIM. The seed
// carries a delayed-departure disruption plus rebooking options so the
// concierge demo can show check-in, loyalty, and disruption arcs end to end.

// Fixed "today" so the demo reads sensibly regardless of when it runs.
const DEPARTURE = "2026-07-14T18:40:00-04:00";
const ARRIVAL = "2026-07-14T22:05:00-05:00";

export const seedPassenger: Passenger = {
  name: "Camila Rojas",
  pnr: "AV7QK2",
  tier: "gold",
  member_id: "AN-4471902",
};

export const seedFlight: Flight = {
  flight_number: "AV1423",
  origin: "SCL",
  origin_city: "Santiago",
  destination: "LIM",
  destination_city: "Lima",
  departure_time: DEPARTURE,
  arrival_time: ARRIVAL,
  aircraft: "Airbus A320neo",
  status: "delayed",
  gate: "A17",
};

function buildSeats(): Seat[] {
  const columns = ["A", "B", "C", "D", "E", "F"] as const;
  const seats: Seat[] = [];
  // Rows 1-4 are premium; row 12 is an exit row; a scattering are occupied.
  const occupied = new Set([
    "6A",
    "6B",
    "7E",
    "8C",
    "9F",
    "10A",
    "10B",
    "11D",
    "14C",
    "15A",
    "15F",
    "18B",
  ]);
  const blocked = new Set(["12A", "12F"]);
  for (let row = 1; row <= 20; row++) {
    for (const column of columns) {
      const id = `${row}${column}`;
      let status: Seat["status"] = "available";
      if (row <= 4) status = "premium";
      else if (row === 12) status = "exit";
      if (occupied.has(id)) status = "occupied";
      if (blocked.has(id)) status = "blocked";
      seats.push({ id, row, column, status });
    }
  }
  return seats;
}

export const seedSeatMap: SeatMap = {
  flight_number: "AV1423",
  rows: 20,
  seats: buildSeats(),
  selected_seat_id: null,
};

export const seedLoyalty: LoyaltyStatus = {
  member_name: "Camila Rojas",
  member_id: "AN-4471902",
  tier: "gold",
  miles: 62450,
  miles_to_next_tier: 17550,
  next_tier: "platinum",
  benefits: [
    "Priority boarding",
    "2 free checked bags",
    "Lounge access",
    "Preferred seating",
    "1.5x miles earning",
  ],
  segments_this_year: 34,
};

export const seedRedemptions: RedemptionOption[] = [
  {
    id: "rd-upgrade-lim",
    title: "Business upgrade to Lima",
    description: "Lie-flat seat, priority security, and lounge on AV1423.",
    miles_required: 18000,
    category: "upgrade",
    emoji: "💺",
  },
  {
    id: "rd-lounge-day",
    title: "Aeronova Lounge day pass",
    description: "Full-day access to the SCL Aeronova lounge for two guests.",
    miles_required: 6500,
    category: "lounge",
    emoji: "🛋️",
  },
  {
    id: "rd-award-uio",
    title: "Award flight to Quito",
    description: "One-way economy award from Lima to Quito, taxes included.",
    miles_required: 22000,
    category: "flight",
    emoji: "✈️",
  },
  {
    id: "rd-hotel-lim",
    title: "2 nights in Lima",
    description: "Partner hotel in Miraflores, breakfast included.",
    miles_required: 31000,
    category: "hotel",
    emoji: "🏨",
  },
  {
    id: "rd-headphones",
    title: "Noise-cancelling headphones",
    description: "Redeem miles for premium travel headphones.",
    miles_required: 14000,
    category: "merchandise",
    emoji: "🎧",
  },
];

export const seedDisruption: DisruptionAlert = {
  flight_number: "AV1423",
  type: "delay",
  severity: "warning",
  message:
    "AV1423 to Lima is delayed roughly 55 minutes due to a late inbound aircraft. Your connection window is unaffected, but rebooking options are available.",
  new_departure_time: "19:35",
  new_gate: "A17",
};

export const seedRebookingOptions: RebookingOption[] = [
  {
    id: "rb-av1451",
    flight_number: "AV1451",
    departure_time: "2026-07-14T20:10:00-04:00",
    arrival_time: "2026-07-14T23:30:00-05:00",
    duration: "3h 20m",
    stops: 0,
    price_difference: 0,
    seats_available: 14,
  },
  {
    id: "rb-av1409",
    flight_number: "AV1409",
    departure_time: "2026-07-14T21:45:00-04:00",
    arrival_time: "2026-07-15T01:05:00-05:00",
    duration: "3h 20m",
    stops: 0,
    price_difference: 0,
    seats_available: 6,
  },
  {
    id: "rb-av2277",
    flight_number: "AV2277",
    departure_time: "2026-07-14T19:15:00-04:00",
    arrival_time: "2026-07-15T00:40:00-05:00",
    duration: "5h 25m",
    stops: 1,
    price_difference: 48,
    seats_available: 21,
  },
];

export const seedBaggage: BaggageItem[] = [
  {
    tag_id: "AN784512",
    status: "loaded",
    last_location: "SCL — Loaded onto AV1423",
    last_updated: "2026-07-14T17:55:00-04:00",
    description: "Silver hardshell, 23 kg",
  },
  {
    tag_id: "AN784513",
    status: "in_transit",
    last_location: "SCL — Baggage sorting",
    last_updated: "2026-07-14T17:40:00-04:00",
    description: "Navy duffel, 12 kg",
  },
];
