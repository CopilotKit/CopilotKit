"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import type { AirlineData } from "../data/types";
import {
  DisruptionAlert,
  RebookingOptions,
  BaggageTracker,
} from "../components";

export function DisruptionsPage() {
  const data = useSkinData<AirlineData>();

  // ── BEAT 3b, part 2 — what is VISIBLY on this screen ─────────────────────
  // `rows` and `baggage` map the SAME arrays handed to <RebookingOptions> and
  // <BaggageTracker> below, in the same order — never a second slice of the same
  // source (demo-beats.md § 3b).
  //
  // `disruption` is reported as null when there is none, rather than omitted: an
  // absent key reads to the agent as "not told", and the page renders an
  // explicit "no active disruptions" panel that it should be able to describe.
  //
  // ONE MECHANICAL CONSTRAINT before rewording any of this: `readables.test.tsx`
  // anchors its omission guard on a `useAgentContext(` window terminated by the
  // statement's own semicolon, so a SEMICOLON in the description below ends that
  // window early and fails the guard for reasons the message will not explain.
  // Use dashes and full stops.
  useAgentContext({
    description:
      "What is on the Disruptions and service screen right now — the active " +
      "disruption if there is one, the rebooking options offered for it, and " +
      "where the passenger's bags are. `visible` is how many rebooking `rows` " +
      "are on screen, in the order shown. A null `disruption` means the screen " +
      "says the flight is on schedule.",
    value: JSON.stringify({
      page: "Disruptions & service",
      disruption: data.disruption
        ? {
            flight: data.disruption.flight_number,
            type: data.disruption.type,
            severity: data.disruption.severity,
            message: data.disruption.message,
            new_departure_time: data.disruption.new_departure_time,
            new_gate: data.disruption.new_gate,
          }
        : null,
      visible: data.rebookingOptions.length,
      rows: data.rebookingOptions.map((o) => ({
        flight: o.flight_number,
        departure: o.departure_time,
        arrival: o.arrival_time,
        duration: o.duration,
        stops: o.stops,
        price_difference: o.price_difference,
        seats_available: o.seats_available,
      })),
      baggage: data.baggage.map((b) => ({
        tag: b.tag_id,
        status: b.status,
        last_location: b.last_location,
        description: b.description,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">
          Disruptions &amp; service
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Delays, rebooking options, and where your bags are.
        </p>
      </div>

      {data.disruption ? (
        <DisruptionAlert disruption={data.disruption} />
      ) : (
        <div className="rounded-2xl border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
          No active disruptions — your flight is on schedule.
        </div>
      )}
      <RebookingOptions
        options={data.rebookingOptions}
        onSelect={data.chooseRebooking}
      />
      <BaggageTracker baggage={data.baggage} />
    </div>
  );
}
