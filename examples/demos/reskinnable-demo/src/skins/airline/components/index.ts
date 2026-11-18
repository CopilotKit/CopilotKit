export { FlightCard } from "./flight-card";
export { SeatMap } from "./seat-map";
export { BoardingPass } from "./boarding-pass";
export { LoyaltyCard } from "./loyalty-card";
export { RedemptionList } from "./redemption-list";
export { DisruptionAlert } from "./disruption-alert";
export { RebookingOptions } from "./rebooking-options";
export { BaggageTracker } from "./baggage-tracker";
export { PassengerHeader } from "./passenger-header";

// BEAT 3a — the card whose digits never enter the transcript.
export { CardConfirmationCard } from "./card-confirmation-card";

// The REST ledger projected onto the check-in shapes. It REPLACED
// `data/use-data.ts`, the second in-memory seed of AV1423.
export { useConciergeView, CHECKIN_BOOKING_ID } from "./concierge-view";
export type { ConciergeView } from "./concierge-view";
export { offerableOptions, permissionFor, blockedByFare } from "./authorizable";

// BEAT 6 — the PASSENGER-facing filing form, and the one sanctioned place the
// fare-waiver vocabulary appears. Mounted by `pages/account.tsx`, never by
// `tools.tsx`: the agent must learn the category by watching, not by reading.
export { FareExceptionForm } from "./fare-exception-form";

// REST-ledger surfaces (beats 3b and 3c), rendered by `pages/account.tsx`,
// `pages/rebook.tsx` and the `showTrips` / `showRebookingOptions` gen-UI.
export { TripList, buildAccountTrips } from "./trip-list";
export type { AccountTrip, TripTone } from "./trip-list";
export {
  OptionBoard,
  CABIN_LABEL,
  FARE_BRAND_LABELS,
  fareDifferenceLabel,
  stopsLabel,
} from "./option-board";
export { orderedSeats, isSelectableSeat } from "./seat-map";
export {
  durationLabel,
  localClock,
  localDate,
  localDateTime,
} from "./local-clock";
