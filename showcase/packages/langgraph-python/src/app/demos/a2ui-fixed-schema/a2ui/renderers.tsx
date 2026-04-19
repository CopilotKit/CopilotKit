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
import React from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { FlightDefinitions } from "./definitions";

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
};
// @endregion[renderers-tsx]
