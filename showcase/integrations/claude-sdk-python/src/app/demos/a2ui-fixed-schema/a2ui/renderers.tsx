"use client";

/**
 * A2UI catalog RENDERERS — React implementations for the custom components
 * declared in `./definitions`. TypeScript enforces that the renderer map's
 * keys and prop shapes match the definitions exactly.
 *
 * NOTE: Props in `definitions.ts` use `DynString` (a `string | { path }`
 * union) so the A2UI `GenericBinder` treats them as dynamic and resolves
 * path bindings before render. The binder USUALLY hands the renderer a
 * resolved string, but if a binding fails to resolve (e.g., op-shape
 * variants that the binder doesn't recognize), the raw `{path}` object
 * leaks through. Rendering `{ path }` as a React child triggers minified
 * React error #31 ("Objects are not valid as a React child"). We use a
 * shared `s()` helper (matching LGP / crewai-crews) to defensively narrow
 * to `string` at the renderer boundary so an unresolved binding renders
 * as empty rather than crashing the page.
 */
import React, { useState } from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { FlightDefinitions } from "./definitions";

// `DynString` props are typed as `string | { path }` (see definitions.ts);
// the binder resolves path bindings before render, but if resolution fails
// the raw object would crash React. Narrow to string here — matches the
// LGP / crewai-crews fixed-schema renderers exactly.
const s = (v: unknown): string => (typeof v === "string" ? v : "");

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
  /**
   * Card override: wraps the basic catalog's Card output in a div carrying
   * the `a2ui-fixed-card` testid so the e2e harness can target the
   * fixed-schema flight card. Mirrors LGP's Card override but adapted to
   * claude-sdk-python's inline-styled div approach.
   */
  Card: ({ props, children }) => {
    const p = props as Record<string, any>;
    return (
      <div data-testid="a2ui-fixed-card">
        {p.child ? children(p.child) : null}
      </div>
    );
  },
  Title: ({ props: rawProps }) => {
    const props = rawProps as Record<string, any>;
    return (
      <div
        style={{
          fontSize: "1.15rem",
          fontWeight: 600,
          color: "#010507",
        }}
      >
        {s(props.text)}
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
        {s(props.code)}
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
        {s(props.name)}
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
        {s(props.amount)}
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
