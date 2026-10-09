"use client";

/**
 * A2UI catalog RENDERERS — React implementations for the custom components
 * declared in `./definitions`. TypeScript enforces that the renderer map's
 * keys and prop shapes match the definitions exactly.
 *
 * Visual style: ShadCN aesthetic (neutral palette, rounded-xl, subtle
 * borders, clean typography). Tailwind utility classes only — no `cn()` /
 * `cva` helpers, no shadcn CLI install. Inline-cloned primitives live in
 * `../_components/`.
 */
import React from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { Definitions } from "./definitions";
import { Card } from "../_components/card";
import { Badge } from "../_components/badge";
import { Button as UIButton } from "../_components/button";
import { Separator } from "../_components/separator";

// `DynString` props are typed as `string | { path }` (see definitions.ts), but
// the A2UI binder resolves path bindings before render — renderers only ever
// see resolved strings. One shared helper keeps that narrowing in one place.
const s = (v: unknown): string => (typeof v === "string" ? v : "");

// @region[renderers-tsx]
export const renderers: CatalogRenderers<Definitions> = {
  /**
   * Card override: ShadCN-style outer container. The basic catalog's Card
   * uses inline styles; overriding here keeps the demo's tailwind aesthetic.
   * The flight schema renders Card > Column > [Title, Row, …]; the inner
   * Column adds the vertical spacing.
   */
  Card: ({ props, children }) => (
    <Card className="w-full max-w-md p-5" data-testid="a2ui-fixed-card">
      {props.child ? children(props.child) : null}
    </Card>
  ),
  Title: ({ props }) => (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
          Itinerary
        </p>
        <h3 className="text-base font-semibold leading-none tracking-tight text-neutral-900">
          {s(props.text)}
        </h3>
      </div>
      <Badge variant="outline" className="font-mono">
        1-stop · economy
      </Badge>
    </div>
  ),
  Airport: ({ props }) => (
    <div className="flex flex-col items-center">
      <span className="font-mono text-2xl font-semibold tracking-wider text-neutral-900">
        {s(props.code)}
      </span>
    </div>
  ),
  Arrow: () => (
    <div className="flex flex-1 items-center px-3">
      <Separator className="flex-1 bg-neutral-200" />
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-1 text-neutral-400"
        aria-hidden
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
      <Separator className="flex-1 bg-neutral-200" />
    </div>
  ),
  AirlineBadge: ({ props }) => (
    <Badge variant="secondary" className="uppercase tracking-[0.08em]">
      {s(props.name)}
    </Badge>
  ),
  PriceTag: ({ props }) => (
    <div className="flex items-baseline gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
        Total
      </span>
      <span className="font-mono text-base font-semibold text-neutral-900">
        {s(props.amount)}
      </span>
    </div>
  ),
  /**
   * Button override: this is a pure-presentation demo, so the button just
   * renders its label. The schema declares an `action` for visual fidelity,
   * but the click handler is inert until the Python SDK exposes
   * `action_handlers=` on `a2ui.render` (see `src/agents/a2ui_fixed.py`).
   */
  Button: ({ props, children }) => (
    <UIButton className="w-full">
      {props.child ? children(props.child) : null}
    </UIButton>
  ),
};
// @endregion[renderers-tsx]
