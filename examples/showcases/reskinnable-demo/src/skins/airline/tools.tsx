"use client";

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
  useComponent(
    {
      name: "showTrips",
      description:
        "Display the whole account as a trip wall — the holder's own bookings " +
        "first, then each saved traveller's, with fare condition and flight " +
        "status on every row. Lead with this whenever the passenger asks how " +
        "their trips look, what is coming up, or what is disrupted.",
      render: () => {
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

  return null;
}

export default AirlineTools;
