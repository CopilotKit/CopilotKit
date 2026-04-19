"use client";

/**
 * A2UI catalog RENDERERS — React implementations for the custom components
 * declared in `./definitions`. TypeScript enforces that the renderer map's
 * keys and prop shapes match the definitions exactly.
 *
 * NOTE: Props in `definitions.ts` use `DynString` (a `string | { path }`
 * union) so the A2UI `GenericBinder` treats them as dynamic and resolves
 * path bindings before render. The binder always hands the renderer a
 * resolved string, but TypeScript sees the raw union — so we cast to
 * `Record<string, any>` at the renderer boundary. This matches the
 * canonical beautiful-chat pattern (see FlightCard in
 * `examples/integrations/langgraph-python/src/app/declarative-generative-ui/renderers.tsx`).
 */
import React, { useState } from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { FlightDefinitions } from "./definitions";

/**
 * Stateful action button: tracks `done` locally so clicking "Book flight"
 * transitions to "Booked ✓" and disables further clicks. Ports the
 * beautiful-chat pattern (see
 * `src/app/demos/beautiful-chat/declarative-generative-ui/renderers.tsx`'s
 * ActionButton). The basic catalog's Button is stateless, so overriding
 * the `Button` entry in this custom catalog is what gives the fixed-schema
 * demo a visible post-click confirmation.
 */
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
        borderRadius: "10px",
        border: done ? "1px solid #bbf7d0" : "1px solid transparent",
        background: done ? "#ecfdf5" : "#2563eb",
        color: done ? "#059669" : "#ffffff",
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
          stroke="#059669"
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
      <div
        style={{
          fontSize: "1.15rem",
          fontWeight: 700,
          color: "#111827",
        }}
      >
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
          fontWeight: 700,
          letterSpacing: "0.05em",
        }}
      >
        {props.code}
      </span>
    );
  },
  Arrow: () => <span style={{ color: "#9ca3af", fontSize: "1.5rem" }}>→</span>,
  AirlineBadge: ({ props: rawProps }) => {
    const props = rawProps as Record<string, any>;
    return (
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
    );
  },
  PriceTag: ({ props: rawProps }) => {
    const props = rawProps as Record<string, any>;
    return (
      <span
        style={{
          fontWeight: 700,
          fontSize: "1.1rem",
          color: "#047857",
        }}
      >
        {props.amount}
      </span>
    );
  },
  /**
   * Button override: the basic catalog's Button is stateless. This
   * stateful version lets clicking "Book flight" transition to
   * "Booked ✓" without a round-trip to the agent.
   */
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
