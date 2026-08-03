"use client";

import { z } from "zod";
import {
  useComponent,
  useHumanInTheLoop,
  useFrontendTool,
  useAgentContext,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";
import { useSkinData } from "@/shell/skin-provider";
import type { AirlineData } from "./data/types";
import {
  FlightCard,
  BoardingPass,
  LoyaltyCard,
  RedemptionList,
  DisruptionAlert,
  RebookingOptions,
  BaggageTracker,
} from "./components";

/**
 * AirlineTools registers everything the Aeronova concierge can do on the
 * client: gen-UI components it renders inline in chat, human-in-the-loop
 * confirmations (seat selection, rebooking), a frontend action (issue boarding
 * pass), and agent-context readables so the model always knows the passenger,
 * flight, booking, and loyalty state. Renders null — it is a registration host.
 */
export function AirlineTools() {
  const data = useSkinData<AirlineData>();

  // ── Agent-context readables ────────────────────────────────────────────
  useAgentContext({
    description: "The current passenger and their frequent-flyer identity.",
    value: JSON.stringify(data.passenger),
  });
  useAgentContext({
    description:
      "The passenger's current flight (numbers, cities, times, gate, status).",
    value: JSON.stringify(data.flight),
  });
  useAgentContext({
    description:
      "The current booking: selected seat (if any) and whether a boarding pass has been issued.",
    value: {
      selected_seat_id: data.seatMap.selected_seat_id,
      boarding_pass_issued: Boolean(data.boardingPass),
      flight_number: data.flight.flight_number,
      pnr: data.passenger.pnr,
    },
  });
  useAgentContext({
    description: "The passenger's Aeronova Club loyalty status and tier.",
    value: JSON.stringify(data.loyalty),
  });

  // ── Gen-UI components (rendered inline in chat by the agent) ────────────
  useComponent({
    name: "showFlight",
    description:
      "Display the passenger's flight as a flight card (route, times, gate, status).",
    render: () => <FlightCard flight={data.flight} />,
  });

  useComponent({
    name: "showLoyalty",
    description:
      "Display the passenger's Aeronova Club loyalty card (tier, miles, progress, benefits).",
    render: () => <LoyaltyCard loyalty={data.loyalty} />,
  });

  useComponent({
    name: "showRedemptions",
    description:
      "Display the miles redemption catalog the passenger can spend miles on.",
    render: () => (
      <RedemptionList
        redemptions={data.redemptions}
        onRedeem={(id) => {
          // Presentational only in the demo; the concierge narrates the result.
          void id;
        }}
      />
    ),
  });

  useComponent({
    name: "showDisruption",
    description:
      "Display the active disruption alert (delay / cancellation / gate change) for the flight.",
    render: () =>
      data.disruption ? (
        <DisruptionAlert disruption={data.disruption} />
      ) : (
        <div className="rounded-2xl border border-dashed border-hairline p-5 text-sm text-ink-muted">
          No active disruption — the flight is on schedule.
        </div>
      ),
  });

  useComponent({
    name: "trackBaggage",
    description: "Display the live status of the passenger's checked bags.",
    render: () => <BaggageTracker baggage={data.baggage} />,
  });

  useComponent({
    name: "showBoardingPass",
    description:
      "Display the issued boarding pass. Only call after a boarding pass has been issued.",
    render: () =>
      data.boardingPass ? (
        <BoardingPass pass={data.boardingPass} />
      ) : (
        <div className="rounded-2xl border border-dashed border-hairline p-5 text-sm text-ink-muted">
          No boarding pass yet — pick a seat, then issue one.
        </div>
      ),
  });

  // ── Frontend action: issue the boarding pass for the selected seat ──────
  useFrontendTool({
    name: "issueBoardingPass",
    description:
      "Issue a boarding pass for the passenger's currently selected seat. Requires a seat to be selected first.",
    handler: async () => {
      const pass = data.issueBoardingPass();
      if (!pass) {
        return "No seat is selected yet — ask the passenger to pick a seat first.";
      }
      return `Boarding pass issued: seat ${pass.seat}, gate ${pass.gate}, boarding ${pass.boarding_time}.`;
    },
    render: ({ status }) => (
      <div className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
        {status === ToolCallStatus.Complete
          ? "Boarding pass issued."
          : "Issuing boarding pass…"}
      </div>
    ),
  });

  // ── HITL: seat selection (confirm before applying) ──────────────────────
  useHumanInTheLoop({
    name: "selectSeat",
    description:
      "Ask the passenger to confirm a seat selection. Provide the seat_id you propose; the passenger confirms or declines.",
    parameters: z.object({
      seat_id: z.string().describe("The seat to select, e.g. '14A'."),
    }),
    render: ({ args, status, respond }) => {
      const seatId = args?.seat_id ?? "";
      if (status === ToolCallStatus.Executing && respond) {
        return (
          <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4">
            <div className="text-sm text-ink">
              Select seat{" "}
              <span className="font-mono font-semibold text-brand">
                {seatId}
              </span>
              ?
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  data.selectSeat(seatId);
                  void respond(`Seat ${seatId} selected.`);
                }}
              >
                Confirm {seatId}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void respond("Passenger declined this seat.")}
              >
                Not this one
              </Button>
            </div>
          </div>
        );
      }
      return (
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
          {status === ToolCallStatus.Complete
            ? `Seat ${seatId} handled.`
            : "Preparing seat selection…"}
        </div>
      );
    },
  });

  // ── HITL: choose a rebooking option (confirm before applying) ───────────
  useHumanInTheLoop({
    name: "chooseRebooking",
    description:
      "Present rebooking options and let the passenger choose one. Pass the option_id you recommend; the passenger confirms.",
    parameters: z.object({
      option_id: z
        .string()
        .describe("The rebooking option id to recommend, e.g. 'rb-av1451'."),
    }),
    render: ({ args, status, respond }) => {
      if (status === ToolCallStatus.Executing && respond) {
        return (
          <div className="flex flex-col gap-3">
            <RebookingOptions
              options={data.rebookingOptions}
              onSelect={(id) => {
                const chosen = data.chooseRebooking(id);
                void respond(
                  chosen
                    ? `Passenger chose rebooking ${chosen.flight_number} (${chosen.id}).`
                    : "Rebooking option not found.",
                );
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                void respond("Passenger kept their original flight.")
              }
            >
              Keep original flight
            </Button>
          </div>
        );
      }
      const recommended = args?.option_id ?? "";
      return (
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
          {status === ToolCallStatus.Complete
            ? "Rebooking handled."
            : `Preparing rebooking options${recommended ? ` (recommending ${recommended})` : ""}…`}
        </div>
      );
    },
  });

  return null;
}
