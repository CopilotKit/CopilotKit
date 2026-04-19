"use client";

/**
 * A2UI catalog RENDERERS — React implementations for the custom components
 * declared in `./definitions`. TypeScript enforces that the renderer map's
 * keys and prop shapes match the definitions exactly.
 */
import React from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { FlightDefinitions } from "./definitions";

// @region[renderers-tsx]
export const flightRenderers: CatalogRenderers<FlightDefinitions> = {
  Title: ({ props }) => (
    <div
      style={{
        fontSize: "1.15rem",
        fontWeight: 700,
        color: "#111827",
      }}
    >
      {props.text}
    </div>
  ),
  Airport: ({ props }) => (
    <span
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "1.5rem",
        fontWeight: 700,
        letterSpacing: "0.05em",
      }}
    >
      {props.code}
    </span>
  ),
  Arrow: () => <span style={{ color: "#9ca3af", fontSize: "1.5rem" }}>→</span>,
  AirlineBadge: ({ props }) => (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        background: "#eef2ff",
        color: "#4338ca",
        borderRadius: 999,
        fontSize: "0.85rem",
        fontWeight: 600,
      }}
    >
      {props.name}
    </span>
  ),
  PriceTag: ({ props }) => (
    <span
      style={{
        fontWeight: 700,
        fontSize: "1.1rem",
        color: "#047857",
      }}
    >
      {props.amount}
    </span>
  ),
};
// @endregion[renderers-tsx]
