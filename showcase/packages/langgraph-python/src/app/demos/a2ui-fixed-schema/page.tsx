"use client";

/**
 * Declarative Generative UI — A2UI Fixed Schema demo.
 *
 * The component tree (schema) is FIXED on the frontend: the agent cannot
 * change the layout — it only streams data into the data model. Here the
 * fixed shape is a flight card: { origin, destination, airline, price }.
 */

import React from "react";
import { z } from "zod";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { createCatalog } from "@copilotkit/a2ui-renderer";

// ── Fixed schema: definitions + renderer for a single FlightCard ────────
// Agent-emitted A2UI data binds to these props via `{ path: "/<key>" }`.
const flightCardDefinitions = {
  FlightCard: {
    description: "A flight card with origin, destination, airline, and price.",
    props: z.object({
      origin: z.union([z.string(), z.object({ path: z.string() })]),
      destination: z.union([z.string(), z.object({ path: z.string() })]),
      airline: z.union([z.string(), z.object({ path: z.string() })]),
      price: z.union([z.string(), z.object({ path: z.string() })]),
    }),
  },
};

function FlightCard({ props }: { props: Record<string, any> }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 20,
        background: "white",
        maxWidth: 340,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600 }}>{props.airline}</span>
        <span style={{ fontWeight: 700, fontSize: "1.15rem" }}>
          {props.price}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 600,
          fontSize: "1rem",
        }}
      >
        <span>{props.origin}</span>
        <span style={{ color: "#9ca3af" }}>→</span>
        <span>{props.destination}</span>
      </div>
    </div>
  );
}

// createCatalog pins the agent's `component: "FlightCard"` ops to this React
// impl. Any property the agent ships that isn't in the Zod schema is ignored.
const fixedCatalog = createCatalog(
  flightCardDefinitions,
  { FlightCard },
  { catalogId: "copilotkit://flight-fixed-catalog" },
);

export default function A2UIFixedSchemaDemo() {
  return (
    // `a2ui.catalog` wires the fixed catalog into the A2UI activity renderer.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="a2ui-fixed-schema"
      a2ui={{ catalog: fixedCatalog }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Find SFO → JFK",
        message: "Find me a flight from SFO to JFK on United for $289.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="a2ui-fixed-schema" className="h-full rounded-2xl" />
  );
}
