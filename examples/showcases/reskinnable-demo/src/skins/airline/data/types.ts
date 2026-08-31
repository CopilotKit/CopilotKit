// Airline CONCIERGE-VIEW types — the check-in shapes the pages and gen-UI cards
// render. They are DERIVED from the REST ledger by `../components/concierge-view.ts`,
// never stored: `data/trip-types.ts` holds what the ledger actually serves. The
// readiness predicates are retained because gen-UI tool arguments stream in and
// may be partially populated before a strict component mounts.

export type Tier = "bronze" | "silver" | "gold" | "platinum";

export type Passenger = {
  name: string;
  pnr: string;
  tier: Tier;
  member_id: string;
};

export type Flight = {
  flight_number: string;
  origin: string;
  origin_city: string;
  destination: string;
  destination_city: string;
  departure_time: string;
  arrival_time: string;
  aircraft: string;
  status: "on_time" | "delayed" | "boarding" | "cancelled" | "departed";
  gate: string | null;
};

export type Seat = {
  id: string;
  row: number;
  column: string;
  status:
    | "available"
    | "occupied"
    | "selected"
    | "premium"
    | "exit"
    | "blocked";
};

export type SeatMap = {
  flight_number: string;
  rows: number;
  seats: Seat[];
  selected_seat_id: string | null;
};

export type BoardingPass = {
  passenger_name: string;
  flight_number: string;
  origin: string;
  destination: string;
  seat: string;
  gate: string;
  boarding_time: string;
  sequence: number;
  pnr: string;
  barcode_data: string;
};

export type LoyaltyStatus = {
  member_name: string;
  member_id: string;
  tier: Tier;
  miles: number;
  miles_to_next_tier: number;
  next_tier: "silver" | "gold" | "platinum" | null;
  benefits: string[];
  segments_this_year: number;
};

export type RedemptionOption = {
  id: string;
  title: string;
  description: string;
  miles_required: number;
  category: "flight" | "upgrade" | "lounge" | "merchandise" | "hotel";
  emoji: string;
};

export type DisruptionAlert = {
  flight_number: string;
  type: "delay" | "cancellation" | "gate_change" | "weather";
  severity: "info" | "warning" | "critical";
  message: string;
  new_departure_time: string | null;
  new_gate: string | null;
};

export type RebookingOption = {
  id: string;
  flight_number: string;
  departure_time: string;
  arrival_time: string;
  duration: string;
  stops: number;
  price_difference: number;
  seats_available: number;
};

export type BaggageItem = {
  tag_id: string;
  status:
    | "checked"
    | "in_transit"
    | "loaded"
    | "arrived"
    | "claimed"
    | "delayed";
  last_location: string;
  last_updated: string;
  description: string;
};

/** The concierge view assembled from the ledger. Kept as a shape, not a store. */
export interface AirlineData {
  passenger: Passenger;
  flight: Flight;
  seatMap: SeatMap;
  boardingPass: BoardingPass | null;
  loyalty: LoyaltyStatus;
  redemptions: RedemptionOption[];
  disruption: DisruptionAlert | null;
  rebookingOptions: RebookingOption[];
  baggage: BaggageItem[];
  /** Select a seat (marks it selected, clears the previous selection). */
  selectSeat: (seatId: string) => void;
  /** Issue a boarding pass for the currently selected seat. */
  issueBoardingPass: () => BoardingPass | null;
  /** Choose a rebooking option (records the choice; returns the option). */
  chooseRebooking: (optionId: string) => RebookingOption | null;
}

// =========================================================================
// Readiness predicates — defend against partial streaming tool arguments.
// =========================================================================

export function isFlightReady(flight: unknown): flight is Flight {
  return (
    !!flight &&
    typeof flight === "object" &&
    typeof (flight as Flight).flight_number === "string" &&
    typeof (flight as Flight).origin === "string" &&
    typeof (flight as Flight).destination === "string"
  );
}

export function isSeatMapReady(sm: unknown): sm is SeatMap {
  return (
    !!sm &&
    typeof sm === "object" &&
    Array.isArray((sm as SeatMap).seats) &&
    (sm as SeatMap).seats.length > 0
  );
}

export function isBoardingPassReady(bp: unknown): bp is BoardingPass {
  return (
    !!bp &&
    typeof bp === "object" &&
    typeof (bp as BoardingPass).passenger_name === "string" &&
    typeof (bp as BoardingPass).seat === "string" &&
    typeof (bp as BoardingPass).gate === "string"
  );
}

export function isLoyaltyReady(l: unknown): l is LoyaltyStatus {
  return (
    !!l &&
    typeof l === "object" &&
    typeof (l as LoyaltyStatus).member_name === "string" &&
    typeof (l as LoyaltyStatus).tier === "string" &&
    typeof (l as LoyaltyStatus).miles === "number"
  );
}

export function isDisruptionReady(d: unknown): d is DisruptionAlert {
  return (
    !!d &&
    typeof d === "object" &&
    typeof (d as DisruptionAlert).type === "string" &&
    typeof (d as DisruptionAlert).message === "string"
  );
}

export function isRedemptionReady(r: unknown): r is RedemptionOption {
  return (
    !!r &&
    typeof r === "object" &&
    typeof (r as RedemptionOption).id === "string" &&
    typeof (r as RedemptionOption).title === "string" &&
    typeof (r as RedemptionOption).miles_required === "number"
  );
}

export function isRebookingReady(r: unknown): r is RebookingOption {
  return (
    !!r &&
    typeof r === "object" &&
    typeof (r as RebookingOption).id === "string" &&
    typeof (r as RebookingOption).flight_number === "string"
  );
}

export function isBaggageReady(b: unknown): b is BaggageItem {
  return (
    !!b &&
    typeof b === "object" &&
    typeof (b as BaggageItem).tag_id === "string" &&
    typeof (b as BaggageItem).status === "string"
  );
}

export function readyArray<T>(
  arr: T[] | null | undefined,
  ready: (item: unknown) => item is T,
): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item) => ready(item));
}
