"use client";

/**
 * FlightCard — the single React component in the fixed A2UI schema.
 *
 * The agent only streams *data* (origin, destination, airline, price) into
 * this fixed component tree; the layout lives here on the frontend.
 */

import React from "react";

export interface FlightCardProps {
  origin: string;
  destination: string;
  airline: string;
  price: string;
}

export function FlightCard({ props }: { props: Record<string, any> }) {
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
