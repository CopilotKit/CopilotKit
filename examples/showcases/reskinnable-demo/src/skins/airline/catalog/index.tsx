"use client";

import { z } from "zod";
import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";
import { Plane } from "lucide-react";

/**
 * The airline a2ui catalog: a compact itinerary / trip-summary surface the
 * agent can render on the shared canvas. Definitions are platform-agnostic Zod
 * schemas; the renderers are React components styled with the shared design
 * tokens so they reskin with the theme.
 */

const legSchema = z.object({
  flight_number: z.string(),
  origin: z.string(),
  destination: z.string(),
  depart: z.string(),
  arrive: z.string(),
  status: z.string().optional(),
});

const definitions = {
  ItinerarySummary: {
    description:
      "A trip itinerary summary card. Use to recap a passenger's journey: a title, the passenger name, and one or more flight legs with times and status.",
    props: z.object({
      title: z.string(),
      passenger: z.string().optional(),
      pnr: z.string().optional(),
      legs: z.array(legSchema),
      note: z.string().optional(),
    }),
  },
} satisfies CatalogDefinitions;

export const airlineCatalog = createCatalog(
  definitions,
  {
    ItinerarySummary: ({ props }) => {
      const legs = Array.isArray(props.legs) ? props.legs : [];
      return (
        <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-soft">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-muted">
                Itinerary
              </div>
              <h2 className="text-lg font-semibold text-ink">{props.title}</h2>
              {props.passenger ? (
                <div className="mt-0.5 text-sm text-ink-muted">
                  {props.passenger}
                  {props.pnr ? (
                    <span className="ml-2 font-mono text-xs">
                      PNR {props.pnr}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <span className="text-brand">
              <Plane className="h-6 w-6" />
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {legs.map((leg, i) => (
              <div
                key={`${leg.flight_number}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-hairline px-4 py-3"
              >
                <span className="w-16 font-mono text-sm font-semibold text-ink">
                  {leg.flight_number}
                </span>
                <span className="flex flex-1 items-center gap-2 text-sm text-ink">
                  <span className="font-semibold">{leg.origin}</span>
                  <Plane className="h-3.5 w-3.5 -rotate-12 text-ink-muted" />
                  <span className="font-semibold">{leg.destination}</span>
                </span>
                <span className="text-xs text-ink-muted">
                  {leg.depart} → {leg.arrive}
                </span>
                {leg.status ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
                    {leg.status}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {props.note ? (
            <p className="mt-4 border-t border-hairline pt-3 text-sm text-ink-muted">
              {props.note}
            </p>
          ) : null}
        </div>
      );
    },
  },
  { catalogId: "airline", includeBasicCatalog: false },
);
