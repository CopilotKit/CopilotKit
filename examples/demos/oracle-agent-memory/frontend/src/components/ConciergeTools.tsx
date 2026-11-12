"use client";

import {
  useRenderTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { FlightOptions } from "@/components/FlightOptions";
import { RecallChip } from "@/components/RecallChip";
import { BookingConfirmCard } from "@/components/BookingConfirmCard";
import { BoardingPass } from "@/components/BoardingPass";
import { parseFlights, getFlight } from "@/lib/flights";

export function ConciergeTools() {
  // Starter-prompt chips shown on each empty thread — they walk the user through
  // the whole demo: teach prefs → search (cards) → book (HITL) → recall in a new thread.
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      {
        title: "Set my travel prefs",
        message:
          "Remember that I fly out of SFO, prefer aisle seats, and like vegetarian meals.",
      },
      {
        title: "Find a flight to Amsterdam",
        message: "Find me a flight to Amsterdam.",
      },
      {
        title: "Book the nonstop",
        message: "Book me flight AMS-001 to Amsterdam.",
      },
      {
        title: "What do you remember?",
        message: "What do you remember about my travel preferences?",
      },
    ],
  });

  useRenderTool({
    name: "search_flights",
    parameters: z.object({ destination: z.string() }),
    render: ({ status, parameters, result }) => {
      if (status !== "complete") {
        return (
          <p className="text-sm text-gray-500 py-2">
            Searching flights to {parameters?.destination ?? "your destination"}
            …
          </p>
        );
      }
      return <FlightOptions flights={parseFlights(result as string)} />;
    },
  });

  useRenderTool({
    name: "recall_memory",
    parameters: z.object({ query: z.string() }),
    render: ({ status, result }) => (
      <RecallChip
        memories={status === "complete" ? (result as string) : undefined}
      />
    ),
  });

  useHumanInTheLoop({
    name: "book_flight",
    description:
      "Confirm with the traveler, then book the chosen flight by its id.",
    parameters: z.object({ flight_id: z.string() }),
    render: ({ status, args, respond }) => {
      const id = (args?.flight_id as string) ?? "";
      if (status === "complete")
        return <BoardingPass flightId={id} flight={getFlight(id)} booked />;
      if (status !== "executing" || !respond) return <></>;
      const flight = getFlight(id);
      return (
        <BookingConfirmCard
          flight={flight}
          flightId={id}
          onConfirm={async () => {
            try {
              await respond(
                `CONFIRMED — booked ${flight?.flight_no ?? id} (${id}). Confirmation sent.`,
              );
            } catch (e) {
              console.error("book_flight respond failed", e);
            }
          }}
          onCancel={async () => {
            try {
              await respond(
                "CANCELLED — the traveler declined; no booking was made.",
              );
            } catch (e) {
              console.error("book_flight respond failed", e);
            }
          }}
        />
      );
    },
  });

  useDefaultRenderTool();
  return null;
}
