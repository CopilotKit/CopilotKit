"use client";

/**
 * A2UI catalog RENDERERS — React implementations for the custom components
 * declared in `./definitions`.
 */
import React, { useState } from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { FlightDefinitions } from "./definitions";

function ActionButton({
  label,
  doneLabel,
  action,
  children: child,
}: {
  label: string;
  doneLabel: string;
  action: unknown;
  children?: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      disabled={done}
      style={{
        width: "100%",
        padding: "10px 16px",
        borderRadius: "12px",
        border: done ? "1px solid #85ECCE4D" : "1px solid transparent",
        background: done ? "rgba(133, 236, 206, 0.15)" : "#010507",
        color: done ? "#189370" : "#ffffff",
        fontSize: "0.9rem",
        fontWeight: 600,
        cursor: done ? "default" : "pointer",
        transition: "all 0.2s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
      }}
      onClick={() => {
        if (done) return;
        if (typeof action === "function") {
          (action as () => void)();
        }
        setDone(true);
      }}
    >
      {done && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#189370"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {done ? doneLabel : (child ?? label)}
    </button>
  );
}

// @region[renderers-tsx]
export const flightRenderers: CatalogRenderers<FlightDefinitions> = {
  Title: ({ props: rawProps }) => {
    const props = rawProps as Record<string, any>;
    return (
      <div style={{ fontSize: "1.15rem", fontWeight: 600, color: "#010507" }}>
        {props.text}
      </div>
    );
  },
  Airport: ({ props: rawProps }) => {
    const props = rawProps as Record<string, any>;
    return (
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "1.5rem",
          fontWeight: 600,
          letterSpacing: "0.05em",
          color: "#010507",
        }}
      >
        {props.code}
      </span>
    );
  },
  Arrow: () => <span style={{ color: "#AFAFB7", fontSize: "1.5rem" }}>→</span>,
  AirlineBadge: ({ props: rawProps }) => {
    const props = rawProps as Record<string, any>;
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 10px",
          background: "rgba(190, 194, 255, 0.15)",
          color: "#010507",
          border: "1px solid #BEC2FF",
          borderRadius: 999,
          fontSize: "0.75rem",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {props.name}
      </span>
    );
  },
  PriceTag: ({ props: rawProps }) => {
    const props = rawProps as Record<string, any>;
    return (
      <span
        style={{
          fontWeight: 600,
          fontSize: "1.1rem",
          color: "#189370",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {props.amount}
      </span>
    );
  },
  Button: ({ props, children }) => {
    return (
      <ActionButton
        label="Book flight"
        doneLabel="Booked"
        action={(props as Record<string, any>).action}
      >
        {(props as Record<string, any>).child
          ? children((props as Record<string, any>).child)
          : null}
      </ActionButton>
    );
  },
};
// @endregion[renderers-tsx]
