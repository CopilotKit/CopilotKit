"use client";

/**
 * Generative UI RENDERERS — React implementations for the custom components
 * declared in `./definitions`. Each component's props are typed from its
 * schema, so the renderer and the definition cannot drift apart.
 *
 * Visual style: ShadCN aesthetic (neutral palette, rounded-xl, subtle
 * borders, clean typography). Tailwind utility classes only — no `cn()` /
 * `cva` helpers, no shadcn CLI install. Inline-cloned primitives live in
 * `../_components/`.
 */
import React from "react";

import type { z } from "zod";

import type { Definitions } from "./definitions";
import { Card } from "../_components/card";
import { Badge } from "../_components/badge";
import { Button as UIButton } from "../_components/button";
import { Separator } from "../_components/separator";


/**
 * The props a component gets: the output of its schema. Generative UI
 * resolves data bindings before render, and hands `child` / `children` over
 * as rendered nodes.
 */
type PropsOf<Name extends keyof Definitions> = z.output<
  Definitions[Name]["props"]
>;

// @region[renderers-tsx]
export const renderers = {
  /**
   * Card override: ShadCN-style outer container. The standard Card
   * uses inline styles; overriding here keeps the demo's tailwind aesthetic.
   * The flight schema renders Card > Column > [Title, Row, …]; the inner
   * Column adds the vertical spacing.
   */
  Card: (props: PropsOf<"Card">) => (
    <Card className="w-full max-w-md p-5" data-testid="a2ui-fixed-card">
      {props.child}
    </Card>
  ),
  Title: (props: PropsOf<"Title">) => (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-muted-foreground">
          Itinerary
        </p>
        <h3 className="text-base font-semibold leading-none tracking-tight text-neutral-900 dark:text-foreground">
          {props.text}
        </h3>
      </div>
      <Badge variant="outline" className="font-mono">
        1-stop · economy
      </Badge>
    </div>
  ),
  Airport: (props: PropsOf<"Airport">) => (
    <div className="flex flex-col items-center">
      <span className="font-mono text-2xl font-semibold tracking-wider text-neutral-900 dark:text-foreground">
        {props.code}
      </span>
    </div>
  ),
  Arrow: () => (
    <div className="flex flex-1 items-center px-3">
      <Separator className="flex-1 bg-neutral-200 dark:bg-border" />
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-1 text-neutral-400 dark:text-muted-foreground"
        aria-hidden
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
      <Separator className="flex-1 bg-neutral-200 dark:bg-border" />
    </div>
  ),
  AirlineBadge: (props: PropsOf<"AirlineBadge">) => (
    <Badge variant="secondary" className="uppercase tracking-[0.08em]">
      {props.name}
    </Badge>
  ),
  PriceTag: (props: PropsOf<"PriceTag">) => (
    <div className="flex items-baseline gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-muted-foreground">
        Total
      </span>
      <span className="font-mono text-base font-semibold text-neutral-900 dark:text-foreground">
        {props.amount}
      </span>
    </div>
  ),
  /**
   * Button override: this is a pure-presentation demo, so the button just
   * renders its label. The schema declares an `onClick` event (the agent's
   * v0.9 `action`) for visual fidelity,
   * but the click handler is inert until the Python SDK exposes
   * `action_handlers=` on `a2ui.render` (see `src/demo_agents/a2ui_fixed.py`).
   */
  Button: (props: PropsOf<"Button">) => (
    <UIButton className="w-full">
      {props.child}
    </UIButton>
  ),
};
// @endregion[renderers-tsx]
