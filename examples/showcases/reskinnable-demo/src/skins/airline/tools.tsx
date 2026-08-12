"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";
import {
  useComponent,
  useHumanInTheLoop,
  useFrontendTool,
  useAgentContext,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { useRecording } from "@/shell/teach";
// BEAT 6's directive strings, each a builder beside its reader so a card can only
// state what its producer reported. NOTHING in that module names a fare-exception
// category — the one the agent is told about is whatever the passenger actually
// filed, passed through at runtime.
import {
  OFFER_ACCEPTED,
  OFFER_DECLINED,
  SAVE_PROCEDURE_CONFIRMED,
  SAVE_PROCEDURE_DECLINED,
  buildDemonstrationDirective,
  classifySaveProcedureResult,
  readDemonstratedStepCount,
  readOfferAccepted,
} from "./teach-mode-directives";
import { useAirlineLedger, notifyAirlineDataChanged } from "./ledger-context";
import { useConciergeView } from "./components/concierge-view";
import { offerableOptions } from "./components/authorizable";
import {
  FlightCard,
  SeatMap,
  BoardingPass,
  LoyaltyCard,
  RedemptionList,
  DisruptionAlert,
  BaggageTracker,
  OptionBoard,
  TripList,
  buildAccountTrips,
  CardConfirmationCard,
} from "./components";
// BEAT 5's vocabulary, and the one closed set in this skin the agent is
// deliberately GIVEN — see data/handling.ts for why that is the exact opposite
// of the fare-waiver catalogue and why the identifiers are named as they are.
import {
  NOTICE_TEMPLATES,
  NOTIFY_PARTIES,
  SEAT_PREFERENCES,
} from "./data/handling";
import {
  CABIN_ARGUMENTS,
  SORT_ARGUMENTS,
  STOPS_ARGUMENTS,
  WINDOW_ARGUMENTS,
  leverChips,
  leverQuery,
  normalizeLevers,
} from "./data/rebooking-levers";
import { REBOOK_SEGMENT } from "./pages/rebook";
// NOTE: the fare-waiver catalogue is deliberately NOT imported here. See
// data/fare-waiver-codes.ts — beat 6 requires the unlock vocabulary be withheld
// from the agent, and this file is the agent's whole view of the app. The
// `withheldGateVocabulary` rule in eslint.config.mjs fails the build if a
// `*_CODES` / `*_CODE_LABELS` identifier reappears here.

const BASE = "/api/airline/v1";

/**
 * One write, and the sentence the agent gets back.
 *
 * ALWAYS returns a sentence — never throws, never returns undefined. A tool
 * whose handler rejects leaves the run with no result for the call, and the next
 * message fails the whole thread with "Tool result is missing for tool call …".
 * A refused write is prefixed `REJECTED:` and carries the SERVER's own message
 * verbatim, because that message is the only thing the agent can act on — and on
 * the change route it is the beat-6 gate speaking.
 */
async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok) {
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : `The request was refused (HTTP ${res.status}).`;
      return { ok: false, error: message };
    }
    notifyAirlineDataChanged();
    return { ok: true, data: payload ?? {} };
  } catch (error) {
    console.error(`[airline] POST ${path} failed:`, error);
    return {
      ok: false,
      error: "The request could not be sent. Nothing changed.",
    };
  }
}

/**
 * BEAT 2 — every terminal render below reads `result`, never `status`.
 *
 * On replay (a reopened thread, or the hard reload beat 2 performs on stage) the
 * recorded tool result is handed back but no status transition ever fires, so a
 * branch chosen by `status === ToolCallStatus.Complete` renders its PENDING copy
 * forever. `result` is the only thing that survives a reload — and it carries the
 * real outcome sentence, so the replayed card reads better too.
 *
 * `String(result)` rather than a `typeof result === "string"` narrow: the value
 * is whatever the runtime recorded, and a type test that misses turns a real
 * outcome back into "preparing…" — silently, and only on replay.
 */
function ToolNote({ result, pending }: { result: unknown; pending: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
      {result === undefined || result === null ? pending : String(result)}
    </div>
  );
}

/**
 * BEAT 4 — the band that makes recall VISIBLE.
 *
 * Rendered above the trip wall, tinted with the brand's soft surface so it reads
 * as the assistant speaking rather than as another data row. It carries the
 * agent's OWN sentence naming the preference it applied.
 *
 * Renders nothing for an absent or blank note, which is the honest state when
 * nothing was recalled — and it is why the band is not decoration: on the OSS path
 * there is no `recall_memory`, the note comes back empty, and the room correctly
 * sees no claim of memory rather than an empty violet stripe. `note` streams, so
 * `undefined` mid-render must not print a band either.
 */
function PreferenceNote({ note }: { note?: string }) {
  const text = (note ?? "").trim();
  if (text === "") return null;
  return (
    <div className="rounded-lg border border-brand/30 bg-brand-soft px-3.5 py-2.5 text-xs leading-relaxed text-brand-indigo dark:text-brand-violet">
      <span className="font-semibold uppercase tracking-wide">Remembered</span>
      <span className="mx-1.5" aria-hidden>
        ·
      </span>
      {text}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline p-5 text-sm text-ink-muted">
      {children}
    </div>
  );
}

/**
 * AirlineTools registers everything the Aeronova concierge can do on the client:
 * gen-UI it renders inline in chat, human-in-the-loop cards for anything that
 * spends money or files a record, the three ordinary writes beat 5's stored
 * procedure runs, and agent-context readables so the model always knows the
 * account, its bookings and the replacements on offer. Renders null — it is a
 * registration host.
 */
export function AirlineTools() {
  const ledger = useAirlineLedger();
  const { ready, profile, travelers, bookings, flights, options, exceptions } =
    ledger;
  const view = useConciergeView();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const router = useRouter();

  /** A booking by id OR by PNR — but never a PNR two legs share. */
  const findBooking = (ref: string) => {
    const trimmed = (ref ?? "").trim();
    if (!trimmed) return null;
    const byId = bookings.find((b) => b.id === trimmed);
    if (byId) return byId;
    const byRef = bookings.filter((b) => b.reference === trimmed);
    // Camila's outbound and her return both sit under AV7QK2, which is how a
    // real reservation works. Taking the first match would reissue the wrong leg
    // while reporting success — the API answers 409 AMBIGUOUS_REFERENCE for
    // exactly this, and the client must not undo it.
    return byRef.length === 1 ? byRef[0]! : null;
  };
  const flightOf = (bookingId: string) => {
    const booking = bookings.find((b) => b.id === bookingId);
    return flights.find((f) => f.id === booking?.flightId) ?? null;
  };

  // ── Agent-context readables ──────────────────────────────────────────────
  useAgentContext({
    description:
      "The Aeronova account this app is signed in to — the account holder, the " +
      "travellers saved on it, and the card on file as a brand and dots. There " +
      "are no card digits anywhere in this app and you must never ask for them.",
    value: JSON.stringify({
      loading: !ready,
      account_name: profile?.accountName ?? null,
      member_since: profile?.memberSince ?? null,
      payment_card: profile?.paymentCardLabel ?? null,
      travellers: travelers.map((t) => ({
        id: t.id,
        name: t.name,
        member_id: t.memberId,
        tier: t.tier,
        home_timezone: t.homeTimezone,
        account_holder: t.accountHolder,
        relationship: t.relationship,
      })),
    }),
  });

  useAgentContext({
    description:
      "Every booking on the account, with the flight it is ticketed on and what " +
      "the fare permits. `fare_notes` is the prose the passenger reads on their " +
      "own booking — read it before proposing anything about a refused change. " +
      "`changeable` is what the FARE allows for a voluntary change, and a " +
      "cancelled flight or a large schedule move overrides it.",
    value: JSON.stringify(
      bookings.map((booking) => {
        const flight = flights.find((f) => f.id === booking.flightId);
        const traveler = travelers.find((t) => t.id === booking.travelerId);
        return {
          booking_id: booking.id,
          confirmation: booking.reference,
          traveller: traveler?.name ?? null,
          flight: flight?.flightNumber ?? null,
          route: flight
            ? `${flight.originCity} → ${flight.destinationCity}`
            : null,
          departs_local: flight?.departureLocal ?? null,
          arrives_local: flight?.arrivalLocal ?? null,
          flight_status: flight?.status ?? null,
          delay_minutes: flight?.delayMinutes ?? null,
          schedule_change_minutes: flight?.scheduleChangeMinutes ?? null,
          fare: booking.fare.brandLabel,
          changeable: booking.fare.changeable,
          change_fee_usd: booking.fare.changeFeeUsd,
          seat: booking.seat,
          status: booking.status,
          reissued_onto: booking.reissued?.flightNumber ?? null,
          has_approved_exception: Boolean(booking.activeExceptionId),
          fare_notes: booking.fareNotes,
          notices: booking.notices.map((n) => n.party),
        };
      }),
    ),
  });

  useAgentContext({
    description:
      "The replacement flights on offer for each booking. Use an `option_id` " +
      "from here whenever a tool asks for one — never invent an id, and never " +
      "quote a fare difference this list does not carry.",
    value: JSON.stringify(
      options.map((o) => ({
        option_id: o.id,
        booking_id: o.bookingId,
        flight: o.flightNumber,
        origin: o.origin,
        destination: o.destination,
        departs_local: o.departureLocal,
        arrives_local: o.arrivalLocal,
        duration_minutes: o.durationMinutes,
        stops: o.stops,
        cabin: o.cabin,
        fare_brand: o.fareBrand,
        fare_difference_usd: o.fareDifferenceUsd,
        seats_available: o.seatsAvailable,
      })),
    ),
  });

  useAgentContext({
    description:
      "The trip the check-in screen is about — the flight, the seat currently " +
      "held, and whether a boarding pass has been issued in this session.",
    value: JSON.stringify({
      loading: !view.ready,
      booking_id: view.bookingId,
      pnr: view.passenger?.pnr ?? null,
      flight: view.flight?.flight_number ?? null,
      flight_status: view.flight?.status ?? null,
      gate: view.flight?.gate ?? null,
      selected_seat: view.seatMap.selected_seat_id,
      boarding_pass_issued: Boolean(view.boardingPass),
    }),
  });

  useAgentContext({
    description:
      "The passenger's Aeronova Club standing — tier, mileage balance and " +
      "benefits. Miles are `miles`, never `points`.",
    value: JSON.stringify(view.loyalty),
  });

  // NO fare-waiver-category readable. That is beat 6: the agent must learn which
  // category lifts the fare gate by watching the passenger file one.

  // ══ BEAT 1 — GEN-UI IN THE TRANSCRIPT ════════════════════════════════════
  // The lead card. Every booking on the account, its fare condition, and what is
  // disrupted right now — the trip wall the beat opens on.
  //
  // ══ …AND BEAT 4 — THE VISIBLE "WHY" ══════════════════════════════════════
  // The same card carries the `note` slot, which is where the agent NAMES the
  // standing preference it recalled and applied. That band IS beat 4: without it
  // the room watches a competent trip summary and has no way to know anything was
  // remembered, so the beat is invisible and does not count
  // (`data/beat-map.md` § "Beat 4 — the preferences"; banking's
  // `showSpendSummary` `note` parameter is the pattern).
  //
  // REQUIRED rather than optional, deliberately: an optional slot is the one a
  // model omits, and the omission is silent. Empty text still renders no band —
  // the honest state when nothing was recalled — but the model has to decide
  // rather than skip.
  useComponent(
    {
      name: "showTrips",
      description:
        "Display the whole account as a trip wall — the holder's own bookings " +
        "first, then each saved traveller's, with fare condition and flight " +
        "status on every row. Lead with this whenever the passenger asks how " +
        "their trips look, what is coming up, or what is disrupted. Recall the " +
        "passenger's saved preferences FIRST and put the one you applied in " +
        "`note`, so they can see it was remembered.",
      parameters: z.object({
        note: z
          .string()
          .describe(
            "One short footnote naming the remembered preference you applied " +
              "to this summary — the seat kind, the fare you skipped, the clock " +
              "you quoted times in, or what you led with. Leave it empty ONLY " +
              "if you genuinely recalled nothing.",
          ),
      }),
      render: ({ note }) => {
        const holder = travelers.find((t) => t.accountHolder) ?? null;
        if (!holder) {
          return (
            <EmptyNote>
              {ready ? "No account is loaded." : "Pulling up the account…"}
            </EmptyNote>
          );
        }
        const companions = travelers.filter((t) => !t.accountHolder);
        return (
          <div className="flex flex-col gap-4">
            <PreferenceNote note={note} />
            <TripList
              label="Your trips"
              trips={buildAccountTrips(bookings, flights, holder)}
              empty="You have no upcoming trips."
            />
            {companions.map((traveler) => (
              <div key={traveler.id} className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {traveler.name} · your {traveler.relationship.toLowerCase()}
                </div>
                <TripList
                  label={`Trips booked for ${traveler.name}`}
                  trips={buildAccountTrips(bookings, flights, traveler)}
                  empty={`No trips booked for ${traveler.name}.`}
                />
              </div>
            ))}
          </div>
        );
      },
    },
    [travelers, bookings, flights, ready],
  );

  useComponent(
    {
      name: "showRebookingOptions",
      description:
        "Display the replacement flights available on ONE booking, as a board. " +
        "Pass the confirmation code or booking id. Use this before recommending " +
        "any specific replacement.",
      parameters: z.object({
        booking: z.string().describe("Confirmation code or booking id."),
      }),
      render: ({ booking: ref }) => {
        const booking = findBooking(ref ?? "");
        if (!booking) {
          return <EmptyNote>No booking matches that reference.</EmptyNote>;
        }
        return (
          <OptionBoard
            options={options.filter((o) => o.bookingId === booking.id)}
          />
        );
      },
    },
    [bookings, options],
  );

  useComponent(
    {
      name: "showFlight",
      description:
        "Display the check-in flight as a flight card (route, times, gate, status).",
      render: () =>
        view.flight ? (
          <FlightCard flight={view.flight} />
        ) : (
          <EmptyNote>
            {view.ready ? "No upcoming flight." : "Pulling up your flight…"}
          </EmptyNote>
        ),
    },
    [view.flight, view.ready],
  );

  useComponent(
    {
      name: "showSeatMap",
      description:
        "Display the cabin map for the check-in flight so the passenger can see " +
        "which seats are still free.",
      render: () => <SeatMap seatMap={view.seatMap} />,
    },
    [view.seatMap],
  );

  useComponent(
    {
      name: "showLoyalty",
      description:
        "Display the passenger's Aeronova Club loyalty card (tier, miles, progress, benefits).",
      render: () =>
        view.loyalty ? (
          <LoyaltyCard loyalty={view.loyalty} />
        ) : (
          <EmptyNote>Pulling up your Aeronova Club standing…</EmptyNote>
        ),
    },
    [view.loyalty],
  );

  useComponent(
    {
      name: "showRedemptions",
      description:
        "Display the miles redemption catalog the passenger can spend miles on.",
      render: () => <RedemptionList redemptions={view.redemptions} />,
    },
    [view.redemptions],
  );

  useComponent(
    {
      name: "showDisruption",
      description:
        "Display the active disruption on the check-in flight (delay, cancellation or schedule move).",
      render: () =>
        view.disruption ? (
          <DisruptionAlert disruption={view.disruption} />
        ) : (
          <EmptyNote>
            No active disruption — the flight is on schedule.
          </EmptyNote>
        ),
    },
    [view.disruption],
  );

  useComponent(
    {
      name: "trackBaggage",
      description: "Display the live status of the passenger's checked bags.",
      render: () => <BaggageTracker baggage={view.baggage} />,
    },
    [view.baggage],
  );

  useComponent(
    {
      name: "showBoardingPass",
      description:
        "Display the issued boarding pass. Only call after one has been issued.",
      render: () =>
        view.boardingPass ? (
          <BoardingPass pass={view.boardingPass} />
        ) : (
          <EmptyNote>
            No boarding pass yet — pick a seat, then issue one.
          </EmptyNote>
        ),
    },
    [view.boardingPass],
  );

  // ── Frontend action: issue the boarding pass for the held seat ────────────
  useFrontendTool(
    {
      name: "issueBoardingPass",
      description:
        "Issue a boarding pass for the seat the passenger currently holds on the check-in flight.",
      handler: async () => {
        const pass = view.issueBoardingPass();
        return pass
          ? `Boarding pass issued: seat ${pass.seat}, gate ${pass.gate}, boarding ${pass.boarding_time}.`
          : "No seat is held on that booking yet — pick one first.";
      },
      // Replay-safe: the terminal copy is the handler's own sentence.
      render: ({ result }) => (
        <ToolNote result={result} pending="Issuing the boarding pass…" />
      ),
    },
    [view],
  );

  // ══ BEAT 3c — NAVIGATE VIA THE APP'S REAL LEVERS ═════════════════════════
  // A plain `navigateTo` does not earn this beat. The room has to see the levers
  // NAMED before anything moves and TINTED on the page afterwards, so the claim
  // "it reached the app's real controls" is something they can check rather than
  // take on faith.
  useHumanInTheLoop(
    {
      name: "showRebookingSearch",
      description:
        "Take the passenger to the rebooking search with a departure window, a " +
        "stops filter, a cabin, a sort order and a top-N limit applied. Confirm " +
        "with them first — the card lists the levers before anything moves. " +
        "EVERY lever is REQUIRED: set the ones the request implies, and pass " +
        "'all' (or 0 for the limit) for the ones it does not — that is how you " +
        "say 'leave this lever alone', and it is the only way to say it. Never " +
        "omit a lever, and never fill one merely because the schema offers it: a " +
        "filter the passenger did not ask for narrows the board for no reason " +
        "and claims a choice they never made. Afterwards, say which controls are " +
        "set and how many flights the board is showing out of how many match.",
      parameters: z.object({
        booking: z
          .string()
          .describe(
            "Which of the passenger's own bookings to search replacements for — confirmation code or booking id. This is the SUBJECT of the search, not a filter.",
          ),
        window: z
          .enum(WINDOW_ARGUMENTS)
          .describe(
            "Restrict to one departure window, or 'all' for any time of day.",
          ),
        stops: z
          .enum(STOPS_ARGUMENTS)
          .describe("Restrict by number of stops, or 'all' for any."),
        cabin: z
          .enum(CABIN_ARGUMENTS)
          .describe("Restrict to one cabin, or 'all' for any."),
        sort: z
          .enum(SORT_ARGUMENTS)
          .describe("Row order, or 'all' to keep the board's own order."),
        top: z
          .number()
          .int()
          .min(0)
          .describe("Limit to the first N rows. Use 0 for no limit."),
      }),
      render: ({ args, status: toolStatus, respond, result }) => {
        // Normalized from ONE record — the same one the URL below is built from,
        // so the view this opens is the view the card just promised. Arguments
        // STREAM, so mid-render a lever that has not arrived yet is simply unset
        // and draws NO chip; a `?? "all"` default would assert a choice the
        // agent never made and then flip when the real value landed.
        const levers = normalizeLevers(args ?? {});
        const chips = leverChips(levers);
        if (toolStatus === ToolCallStatus.Executing && respond) {
          const booking = findBooking(args?.booking ?? "");
          return (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
              <div className="text-sm text-ink">
                {chips.length
                  ? "Open the rebooking search with these filters set?"
                  : "Open the rebooking search?"}
              </div>
              {chips.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c.label}
                      className="rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand-indigo dark:text-brand-violet"
                    >
                      {c.label}: {c.value}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                  onClick={() => {
                    const query = [
                      booking
                        ? `booking=${encodeURIComponent(booking.id)}`
                        : "",
                      leverQuery(levers),
                    ]
                      .filter(Boolean)
                      .join("&");
                    // Through skinHref, never a hardcoded `/airline/rebook` —
                    // under LOCK_SKIN this deploy is served at `/` and a literal
                    // prefix would reappear in the address bar on the first
                    // click. `pnpm lint` fails the hardcoded form.
                    let navigated = true;
                    try {
                      router.push(
                        `${skinHref(REBOOK_SEGMENT)}${query ? `?${query}` : ""}`,
                      );
                    } catch (error) {
                      navigated = false;
                      console.error(
                        "[airline] could not open the rebooking search",
                        error,
                      );
                    }
                    // Respond either way: a throw that escaped this handler
                    // would leave the interrupt unsettled and WEDGE the run,
                    // which is the one outcome worse than not navigating.
                    void respond(
                      navigated
                        ? `Opened the rebooking search${
                            chips.length
                              ? ` with ${chips
                                  .map(
                                    (c) =>
                                      `${c.label.toLowerCase()} ${c.value.toLowerCase()}`,
                                  )
                                  .join(", ")}`
                              : ""
                          }. The controls are highlighted on screen.`
                        : "Could not open the rebooking search — the navigation failed, so the passenger is still where they were.",
                    );
                  }}
                >
                  Apply and go
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                  onClick={() =>
                    void respond("Passenger declined the navigation.")
                  }
                >
                  Not now
                </button>
              </div>
            </div>
          );
        }
        return <ToolNote result={result} pending="Preparing the view…" />;
      },
    },
    [router, skinHref, bookings],
  );

  // ══ BEAT 5 / BEAT 6 — THE REISSUE, AND THE GATE IT RUNS INTO ═════════════
  // `POST /bookings/:id/change` commits only when NOTHING is due. When money is
  // due it stops at 402 and names the amount, which is what makes beat 3a's card
  // the only path that commits a paid change rather than a decorative step.
  useFrontendTool(
    {
      name: "rebookOntoOption",
      description:
        "Reissue a booking onto one of its replacement flights. Pass the " +
        "confirmation code (or booking id) and an `option_id` from the " +
        "replacement list. The server recomputes every figure and may REFUSE: " +
        "if the reply starts with 'REJECTED:' relay it plainly, do not retry the " +
        "same reissue, and do not claim success. If it says PAYMENT IS DUE, the " +
        "change is permitted and only the money is outstanding — offer to " +
        "confirm the card on file.",
      parameters: z.object({
        booking: z.string().describe("Confirmation code or booking id."),
        optionId: z
          .string()
          .describe(
            "The option_id of the replacement flight, from the list you were given.",
          ),
      }),
      handler: async ({ booking: ref, optionId }) => {
        const booking = findBooking(ref ?? "");
        if (!booking)
          return "No single booking matches that reference; nothing was changed.";
        const outcome = await post(
          `/bookings/${encodeURIComponent(booking.id)}/change`,
          { optionId: optionId ?? "" },
        );
        if (outcome.ok) {
          const reissue = outcome.data.reissue as
            | { flightNumber?: string }
            | undefined;
          return `${booking.reference} is reissued onto ${
            reissue?.flightNumber ?? "the new flight"
          } at no cost.`;
        }
        return `REJECTED: ${outcome.error}`;
      },
      // Replay-safe — the handler's own sentence, including the gate's refusal.
      render: ({ result }) => (
        <ToolNote result={result} pending="Reissuing the booking…" />
      ),
    },
    [bookings],
  );

  useFrontendTool(
    {
      name: "reseatPassenger",
      description:
        "Move the passenger to a seat matching a preference on whatever " +
        "itinerary the booking is on now. You name the PREFERENCE, never a seat " +
        "— the server picks from the seats actually free and refuses rather than " +
        "inventing one.",
      parameters: z.object({
        booking: z.string().describe("Confirmation code or booking id."),
        preference: z
          .enum(SEAT_PREFERENCES)
          .describe("Which kind of seat the passenger wants."),
      }),
      handler: async ({ booking: ref, preference }) => {
        const booking = findBooking(ref ?? "");
        if (!booking)
          return "No single booking matches that reference; the seat is unchanged.";
        const outcome = await post(
          `/bookings/${encodeURIComponent(booking.id)}/seat`,
          { preference: preference ?? "aisle" },
        );
        return outcome.ok
          ? `${booking.reference} is now in seat ${String(outcome.data.seat)} — ${preference}.`
          : `REJECTED: ${outcome.error}`;
      },
      render: ({ result }) => (
        <ToolNote result={result} pending="Moving the seat…" />
      ),
    },
    [bookings],
  );

  useFrontendTool(
    {
      name: "notifyTripParty",
      description:
        "Tell somebody downstream of the trip that it has moved. The contact is " +
        "copied off the BOOKING — never supply a name or a number yourself. A " +
        "party the booking has no contact for is refused, so Aeronova never " +
        "claims to have reached someone it cannot.",
      parameters: z.object({
        booking: z.string().describe("Confirmation code or booking id."),
        party: z.enum(NOTIFY_PARTIES).describe("Who gets told."),
        template: z
          .enum(NOTICE_TEMPLATES)
          .describe("Which templated message to send."),
      }),
      handler: async ({ booking: ref, party, template }) => {
        const booking = findBooking(ref ?? "");
        if (!booking)
          return "No single booking matches that reference; nobody was told.";
        const outcome = await post(
          `/bookings/${encodeURIComponent(booking.id)}/notify`,
          {
            party: party ?? "arrival-pickup",
            template: template ?? "delay-advisory",
          },
        );
        if (!outcome.ok) return `REJECTED: ${outcome.error}`;
        const notice = outcome.data.notice as { sentTo?: string } | undefined;
        // The recipient is read off the RECORD, not off the model: the sentence
        // read aloud has to name the person the app actually contacted.
        return `Told ${notice?.sentTo ?? party} about ${booking.reference}. It is on the trip log.`;
      },
      render: ({ result }) => (
        <ToolNote result={result} pending="Sending the notice…" />
      ),
    },
    [bookings],
  );

  // ══ BEAT 3a — DRIVE THE APP, SECRET WITHHELD ═════════════════════════════
  // The agent fires this; the PASSENGER types the last four digits of the card
  // on file into the card; the card POSTs them straight to REST. `respond()` gets
  // a confirmation sentence and the digits appear nowhere in the AG-UI stream —
  // which is what the beat is graded on, in the inspector, live.
  //
  // ⚠️ IT IS A SECOND FACTOR, NOT AN ENTITLEMENT OVERRIDE. `POST /authorizations`
  // re-runs the SAME `checkFareChange()` the ordinary change route runs, so a
  // valid confirmation on a non-changeable fare is still refused. The card below
  // is only OFFERED on an option the passenger is already entitled to take and
  // where money is genuinely due (`offerableOptions`), and even that is a display
  // filter — the server decides. If the card could release a refused change it
  // would be a second door around beat 6: the agent would route around the gate,
  // the teach arc would never fire, and NOTHING would fail.
  useHumanInTheLoop(
    {
      name: "authorizeWithCardConfirmation",
      description:
        "Complete a PAID reissue the passenger is already entitled to make, by " +
        "asking them to confirm the card on file. Fire this as soon as they " +
        "agree to pay a fare difference. NEVER ask for card digits, never repeat " +
        "them, and never ask which booking first if the conversation already " +
        "names one. The passenger types the digits into the card and you receive " +
        "only a confirmation sentence — say so if asked. This confirms WHO is " +
        "paying, never what the ticket permits: a fare that refuses a change " +
        "still refuses it, so never offer this as a way past a refusal.",
      parameters: z.object({
        booking: z.string().describe("Confirmation code or booking id."),
        optionId: z
          .string()
          .describe("The option_id of the replacement flight being paid for."),
      }),
      render: ({ args, status: toolStatus, respond, result }) => {
        if (toolStatus === ToolCallStatus.Executing && respond) {
          const booking = findBooking(args?.booking ?? "");
          const flight = booking ? flightOf(booking.id) : null;
          if (!booking || !flight) {
            return (
              <div className="rounded-lg border border-hairline bg-surface p-4 text-sm text-negative">
                No single booking matches that reference.
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => void respond("No such booking.")}
                >
                  Dismiss
                </button>
              </div>
            );
          }
          const offerable = offerableOptions({
            booking,
            flight,
            options,
            exceptions,
          });
          const chosen =
            offerable.find((o) => o.option.id === args?.optionId) ?? null;
          if (!chosen) {
            // Two different refusals, said differently, because the presenter
            // has to be able to tell them apart from the back of the room. A
            // card rendered on something that cannot succeed is worse than no
            // card: the passenger follows the app's own instruction and it
            // refuses with nothing on screen saying why.
            return (
              <div className="rounded-lg border border-hairline bg-surface p-4 text-sm text-negative">
                {offerable.length === 0
                  ? `Nothing is due on ${booking.reference}, or its fare does not permit this change — there is nothing to confirm a card for.`
                  : `That replacement is not one ${booking.reference} can be moved onto for a fee.`}
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() =>
                    void respond(
                      offerable.length === 0
                        ? `No card confirmation applies to ${booking.reference}: either nothing is due, or the fare does not permit the change.`
                        : `That option is not payable on ${booking.reference}.`,
                    )
                  }
                >
                  Dismiss
                </button>
              </div>
            );
          }
          return (
            <CardConfirmationCard
              bookingReference={booking.reference}
              flightNumber={chosen.option.flightNumber}
              optionId={chosen.option.id}
              amountDueUsd={chosen.amountDueUsd}
              cardLabel={profile?.paymentCardLabel ?? "card on file"}
              onAuthorized={(message) => {
                // The card writes through its own fetch, so this bus is what
                // makes the trip record catch up on screen.
                notifyAirlineDataChanged();
                void respond(message);
              }}
              onDeclined={() =>
                void respond("Passenger declined to confirm the card.")
              }
            />
          );
        }
        return (
          <ToolNote result={result} pending="Preparing the confirmation…" />
        );
      },
    },
    [bookings, flights, options, exceptions, profile],
  );

  // ══ BEAT 6 — THE UNLOCK THE AGENT IS NOT GIVEN ═══════════════════════════
  //
  // ⚠️ WHAT IS DELIBERATELY ABSENT. There is no fare-waiver-category readable, no
  // z.enum on the `code` parameter, no category named in any description here,
  // and none in the prompt or the 422 body. Those are the five channels the
  // vocabulary leaks through, and closing four is closing none
  // (`.claude/skills/reskin/failure-modes.md` § 10). `code` is a free
  // `z.string()` whose `.describe()` states the withholding out loud — this
  // INVERTS the enumerate-every-closed-set rule the rest of this file follows,
  // because for a gate, reaching the model IS the defect.
  //
  // Filing and approving are ONE call from the agent's point of view, because
  // there is no review step in the demo — but neither route ever says whether
  // the exception lifts. The only way to find out is to retry the reissue, which
  // is exactly the loop the passenger demonstrates on stage.
  useHumanInTheLoop(
    {
      name: "fileFareException",
      description:
        "File a fare exception against a booking so a refused reissue can be " +
        "reconsidered, and approve it. You do NOT hold the list of categories " +
        "and must not guess one: use the exact category the passenger has used " +
        "before, or ask them which applies. Filing does not guarantee the " +
        "reissue clears — retry it afterwards and report honestly if it still " +
        "refuses.",
      parameters: z.object({
        booking: z.string().describe("Confirmation code or booking id."),
        code: z
          .string()
          .describe(
            "The exception category to file under. You are NOT given the " +
              "catalogue — use the exact category the passenger demonstrated, or " +
              "ask them which one applies.",
          ),
        documentReference: z
          .string()
          .describe(
            "The documentation behind the filing, as the passenger states it. Required — a filing with nothing behind it is refused.",
          ),
        rationale: z
          .string()
          .describe("One short sentence justifying the exception."),
      }),
      render: ({ args, status: toolStatus, respond, result }) => {
        const ref = args?.booking ?? "";
        const code = args?.code ?? "";
        if (toolStatus === ToolCallStatus.Executing && respond) {
          return (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
              <div className="text-sm text-ink">
                File a fare exception{" "}
                <span className="font-mono font-semibold text-brand">
                  {code}
                </span>{" "}
                on <span className="font-mono font-semibold">{ref}</span>?
              </div>
              <div className="text-xs text-ink-muted">
                {args?.documentReference}
              </div>
              <div className="text-xs text-ink-muted">{args?.rationale}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                  onClick={async () => {
                    const booking = findBooking(ref);
                    if (!booking) {
                      return void respond(
                        "No single booking matches that reference; nothing was filed.",
                      );
                    }
                    const filed = await post("/fare-exceptions", {
                      booking: booking.id,
                      code,
                      documentReference: args?.documentReference ?? "",
                      rationale: args?.rationale ?? "",
                    });
                    if (!filed.ok) {
                      return void respond(`REJECTED: ${filed.error}`);
                    }
                    const exception = filed.data.exception as
                      | { id?: string }
                      | undefined;
                    const approved = await post(
                      `/fare-exceptions/${encodeURIComponent(exception?.id ?? "")}/approve`,
                      {},
                    );
                    void respond(
                      approved.ok
                        ? `Fare exception ${code} is filed and approved on ${booking.reference}. Retry the reissue to see whether it now clears.`
                        : `REJECTED: ${approved.error}`,
                    );
                  }}
                >
                  File it
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                  onClick={() =>
                    void respond("Passenger declined to file an exception.")
                  }
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }
        return <ToolNote result={result} pending="Preparing the filing…" />;
      },
    },
    [bookings],
  );

  // ══ BEAT 3d — MULTIMODAL IN, DURABLE ARTIFACT OUT ════════════════════════
  // The passenger attaches a hotel confirmation; the agent reads it and files a
  // Trip Brief that belongs to the APP. Delete the whole thread and the brief is
  // still on the trip record — which is the entire claim.
  //
  // FIELDS ARE SPLIT BY WHO OWNS THE FACT. The hotel's own facts are
  // model-authored, because only a reader of the attachment knows them and that
  // IS the beat's proof. The LEDGER's facts (which booking, whose trip, when it
  // actually lands) are settled server-side and reported back in `settled` /
  // `unmatched`, so the agent is TOLD what was overruled rather than silently
  // overruled. Never send an arrival time or a booking reference here.
  useFrontendTool(
    {
      name: "fileTripBrief",
      description:
        "File a durable Trip Brief from a hotel confirmation the passenger has " +
        "ATTACHED. Read the document and carry ITS OWN facts across — the hotel, " +
        "the confirmation number, the address, the last check-in time, the " +
        "cancellation deadline and the nightly rate — plus the guest name, city " +
        "and check-in date it is addressed to, which are how it is matched to a " +
        "booking. Do NOT supply the flight, the arrival time or the confirmation " +
        "code: those come from the ledger and are settled server-side. Never " +
        "state a time the document does not carry. Afterwards, call " +
        "'render_trip_brief' with the brief id you are given so it opens on the " +
        "canvas, then read out the headline in one line.",
      parameters: z.object({
        hotelName: z
          .string()
          .describe("The hotel, exactly as the document names it."),
        confirmationNumber: z
          .string()
          .describe("The hotel's own confirmation number."),
        address: z.string().describe("The property address as printed."),
        lastCheckInLocal: z
          .string()
          .describe(
            'The latest arrival the hotel accepts, as a clock time like "22:30".',
          ),
        cancellationDeadlineLocal: z
          .string()
          .describe(
            "The cancellation deadline exactly as the document states it.",
          ),
        nightlyRateUsd: z
          .number()
          .describe("The nightly rate in USD, as the document states it."),
        guestName: z
          .string()
          .describe("The guest the reservation is addressed to."),
        city: z.string().describe("The city the reservation is in."),
        checkInDate: z
          .string()
          .describe(
            'The check-in date as an ISO calendar date, e.g. "2026-07-14".',
          ),
      }),
      handler: async (facts) => {
        const outcome = await post("/briefs", { ...facts });
        if (!outcome.ok) return `REJECTED: ${outcome.error}`;
        const brief = outcome.data.brief as
          | { id?: string; headline?: string }
          | undefined;
        const unmatched = Array.isArray(outcome.data.unmatched)
          ? (outcome.data.unmatched as string[])
          : [];
        const tail = unmatched.length
          ? " No Aeronova booking matched this reservation, so the arrival could not be checked — say that rather than implying it was."
          : "";
        return (
          `Trip Brief ${brief?.id ?? ""} is filed on the trip record and stays ` +
          `there whatever happens to this thread. ${brief?.headline ?? ""}` +
          `${tail} Now call render_trip_brief with briefId "${brief?.id ?? ""}".`
        );
      },
      render: ({ result }) => (
        <ToolNote result={result} pending="Filing the trip brief…" />
      ),
    },
    [],
  );

  // ══ BEAT 6 — TEACH IT A PROCEDURE IT DOES NOT HAVE ═══════════════════════
  //
  // The chain, in order: offerWorkflowRecording → awaitDemonstration →
  // saveLearnedProcedure. All three are `followUp: true`, so the agent advances to
  // the next card as soon as one settles rather than stopping to narrate.
  //
  // The REPLAY chain is not new: once the procedure is saved, a later request on a
  // DIFFERENT gated booking goes through the tools that already exist above —
  // `fileFareException` (files + approves in one pair of REST calls) then
  // `rebookOntoOption`, the very write that was refused. Nothing here is
  // special-cased for the replay, which is the point: the agent applies ordinary
  // tools in an order it was never told.
  //
  // ⚠️ THE PROCEDURE IS A PROCEDURE, NOT A STRING. `exceptionLifts` requires the
  // category to match what the booking's own record documents, so replaying the
  // demonstrated category verbatim on the OTHER gated booking is refused —
  // AV3PL9 releases on a schedule-change ground, AV8RT4 on a medical one, and
  // AV5KD1 on nothing at all. What has to transfer is "read what the booking
  // documents, file the category that matches it, approve it, then retry".
  //
  // ⚠️ WHAT IS DELIBERATELY ABSENT. There is no fare-waiver-category readable, no
  // z.enum on any code parameter, no category named in any description here and
  // none in the prompt or the 422 body. Those are five of the six channels the
  // vocabulary leaks through, and closing five of six is closing none
  // (`.claude/skills/reskin/failure-modes.md` § 10). The sixth is Aeronova's own:
  // `Booking.waiverGround` is a code-shaped token that maps 1:1 onto a justifying
  // category, and `store.snapshot()` strips it — the readables above carry
  // `fare_notes`, the human prose, instead. Do not undo that.
  //
  // ⚠️ RUNTIME-CONDITIONAL, IN ONE HALF ONLY. Gate → decline → demonstrate →
  // summarize works on the plain OSS SSE path: every tool here is an ordinary
  // client tool and the REST gate is real. What needs Intelligence is the DURABLE
  // half — `recall_memory` and `save_memory` attach only when the Intelligence
  // runtime is configured. Without it the save card still renders and still
  // settles; the agent simply has no `save_memory` to call, so it reports that it
  // has the procedure for this conversation and nothing crosses to a fresh thread.
  // That degrades to "learned for now", not to an error.

  useHumanInTheLoop(
    {
      followUp: true,
      name: "offerWorkflowRecording",
      description:
        "Offer to WATCH the passenger do something you have no saved procedure " +
        "for. Call this immediately after a reissue is refused because the fare " +
        "does not permit changes and recall_memory turned up nothing — say " +
        "plainly that you do not know this one. Never guess a workaround, " +
        "substitute a cheaper flight, offer the card confirmation, or call " +
        "another tool instead of this.",
      parameters: z.object({
        situation: z
          .string()
          .describe("What you were blocked on, in one short line."),
      }),
      render: ({ args, status: toolStatus, respond, result }) => {
        if (toolStatus === ToolCallStatus.Executing && respond) {
          return (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
              <div className="text-sm text-ink">
                I don&rsquo;t have a saved way through this one
                {args?.situation
                  ? ` — ${args.situation.replace(/\.+$/, "")}`
                  : ""}
                . Show me once and I&rsquo;ll remember it?
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                  onClick={() => void respond(OFFER_ACCEPTED)}
                >
                  Show me
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                  onClick={() => void respond(OFFER_DECLINED)}
                >
                  Not now
                </button>
              </div>
            </div>
          );
        }
        // Replay-safe, and a HUMAN line rather than `result`: that string is an
        // internal directive addressed to the agent ("Call awaitDemonstration
        // now…"), and printing it verbatim puts the demo's own wiring on screen in
        // front of the room.
        return (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            {result === undefined || result === null
              ? "Checking whether I know this one…"
              : readOfferAccepted(result)
                ? "Watching you do it once."
                : "Left it for now — nothing was recorded."}
          </div>
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "awaitDemonstration",
      description:
        "Hold the conversation while the passenger demonstrates. Call this after " +
        "they agree to show you. Do NOT list steps, name a category, or tell them " +
        "where to click — you do not know the procedure, which is the entire " +
        "reason you are watching. Say only something brief like 'go ahead, I'm " +
        "watching'. When they finish you receive the steps they took and the exact " +
        "category they filed.",
      parameters: z.object({}),
      render: ({ status: toolStatus, respond, result }) => {
        if (toolStatus === ToolCallStatus.Executing && respond) {
          // Its own component, so it subscribes to the recorder directly and
          // re-renders on every logged step. Inlining the feed into this closure
          // would freeze it on the `steps` snapshot taken when the card first
          // rendered — which is before the passenger has done anything at all.
          return (
            <DemonstrationCard onDone={(summary) => void respond(summary)} />
          );
        }
        // Replay-safe, and the count is the one the RECORDER reported — never one
        // re-counted out of this prose. See ./teach-mode-directives.
        if (result === undefined || result === null) {
          return (
            <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
              Getting ready to watch…
            </div>
          );
        }
        const count = readDemonstratedStepCount(result);
        return (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            Recorded{" "}
            {count === null
              ? "the demonstration"
              : `${count} ${count === 1 ? "step" : "steps"}`}
            .
          </div>
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "saveLearnedProcedure",
      description:
        "Summarize what you just watched as a numbered procedure and show it to " +
        "the passenger for confirmation. Call this after awaitDemonstration " +
        "reports what it saw, quoting the exact category it reports. Write the " +
        "procedure so it works on a DIFFERENT booking: say to read what that " +
        "booking's own notes document and file the category that matches it, " +
        "rather than always filing the one you just saw. After they confirm, " +
        "persist it with save_memory exactly as the card's result instructs. Save " +
        "it AT MOST ONCE.",
      parameters: z.object({
        procedure: z
          .string()
          .describe(
            "The numbered procedure, naming verbatim the category awaitDemonstration reported. Do not paraphrase it.",
          ),
      }),
      render: ({ args, status: toolStatus, respond, result }) => {
        if (toolStatus === ToolCallStatus.Executing && respond) {
          return (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
              <div className="text-sm font-medium text-ink">
                Here&rsquo;s what I picked up — shall I remember it?
              </div>
              <pre className="whitespace-pre-wrap rounded-md bg-surface-muted p-2.5 text-xs leading-relaxed text-ink">
                {args?.procedure}
              </pre>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                  onClick={() => void respond(SAVE_PROCEDURE_CONFIRMED)}
                >
                  Remember it
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                  onClick={() => void respond(SAVE_PROCEDURE_DECLINED)}
                >
                  Don&rsquo;t save
                </button>
              </div>
            </div>
          );
        }
        // CLASSIFIED, never merely detected. Both buttons settle this card with a
        // string, so "is there a result at all" would print the saved receipt over
        // a decline — asserting a durable write that never happened, live and
        // identically on every replay.
        const outcome = classifySaveProcedureResult(result);
        return (
          <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            {outcome === "saved"
              ? "Saved — I'll use this next time without being asked."
              : outcome === "declined"
                ? "Left it unsaved — nothing was written to memory."
                : outcome === "unknown"
                  ? "This card was already answered."
                  : "Writing up what I saw…"}
          </div>
        );
      },
    },
    [],
  );

  return null;
}

/**
 * BEAT 6 — the live "I'm watching" card.
 *
 * A component rather than an inline render for two reasons, both of which have
 * bitten this app before:
 *
 *  1. It subscribes to the recorder ITSELF, so each `logStep` re-renders the feed.
 *     A feed read from the host card's closure freezes on the snapshot taken
 *     before the passenger touched anything.
 *  2. It OWNS THE OUTER RECORDING BRACKET — `beginRecording()` on mount,
 *     `endRecording()` on unmount. That bracket must stay open across the
 *     passenger's whole demonstration (file the exception, then retry the reissue:
 *     two separate clicks, each with its own NESTED bracket in
 *     `components/fare-exception-form.tsx`). If the ref count reaches zero between
 *     them the shell clears the feed and STRANDS the demonstrated category, and
 *     `getDemonstratedCode()` then reports null on a demonstration that plainly
 *     happened. Holding it here is what makes the two clicks read as one recording.
 *
 * No feed reset on mount: the shell's `beginRecording` clears it when it opens a
 * FRESH window and deliberately inherits an already-open one.
 */
export function DemonstrationCard({
  onDone,
}: {
  onDone: (summary: string) => void;
}) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    beginRecording();
    return () => endRecording();
  }, [beginRecording, endRecording]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-negative opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-negative" />
        </span>
        <span className="text-sm text-ink">
          Watching — go ahead and show me.
        </span>
        <span className="ml-auto text-[0.65rem] font-semibold uppercase tracking-wide text-negative">
          Rec
        </span>
      </div>

      {steps.length > 0 ? (
        <ol className="space-y-1 border-l-2 border-brand/30 pl-3">
          {steps.map((step, index) => (
            <li key={step.id} className="text-xs text-ink">
              <span className="mr-1.5 tabular-nums text-ink-muted">
                {index + 1}.
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs italic text-ink-muted">Nothing captured yet.</p>
      )}

      <button
        type="button"
        disabled={sending}
        className="self-start rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
        onClick={() => {
          // The recorder is the only thing that KNOWS what it caught, so the
          // directive it hands over REPORTS the count and the category; the card
          // that renders the settled result reads them back rather than
          // re-deriving them from the prose. Both halves live in
          // ./teach-mode-directives, held together by a round-trip test.
          //
          // Read BEFORE settling, while this component is still mounted and the
          // bracket is therefore still open — unmounting ends the recording and
          // the shell's minimum-visible hold is the only thing that would keep the
          // feed alive afterwards.
          setSending(true);
          onDone(
            buildDemonstrationDirective({
              steps: steps.map((s) => s.label),
              code: getDemonstratedCode(),
            }),
          );
        }}
      >
        {sending ? "Wrapping up…" : "I'm done"}
      </button>
    </div>
  );
}

export default AirlineTools;
