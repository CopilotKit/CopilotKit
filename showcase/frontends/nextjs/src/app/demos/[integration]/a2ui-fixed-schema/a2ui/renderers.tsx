"use client";

/**
 * A2UI catalog renderers: the React implementation of each component in
 * `./definitions`. TypeScript checks that the keys and prop shapes of the
 * renderer map match the definitions.
 *
 * Visual style: ShadCN aesthetic (neutral palette, rounded-xl, subtle
 * borders, clean typography), with plain Tailwind classes and the
 * inline-cloned primitives in `../_components/`.
 */
import React, { useState } from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { Definitions } from "./definitions";
import { Card } from "../_components/card";
import { Badge } from "../_components/badge";
import { Button as UIButton } from "../_components/button";
import { Separator } from "../_components/separator";

// The binder resolves path bindings before render, so a `DynString` prop
// arrives as a string. A path that holds something else in the data model
// renders as an empty string instead of crashing React.
const s = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The flight card's book button. A click sends the A2UI action to the agent
 * and turns the button into a disabled "Booked" confirmation.
 */
function ActionButton({
  action,
  children,
}: {
  action: (() => unknown) | undefined;
  children?: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <UIButton
      variant={done ? "success" : "default"}
      disabled={done}
      className="w-full"
      onClick={() => {
        if (done) return;
        void action?.();
        setDone(true);
      }}
    >
      {done && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {done ? "Booked" : children}
    </UIButton>
  );
}

// @region[renderers-tsx]
export const renderers: CatalogRenderers<Definitions> = {
  /**
   * Card override: ShadCN-style outer container. The flight schema renders
   * Card > Column > [Title, Row, ...], and the inner Column adds the
   * vertical spacing.
   */
  Card: ({ props, children }) => (
    <Card className="w-full max-w-md p-5" data-testid="a2ui-fixed-card">
      {props.child ? children(props.child) : null}
    </Card>
  ),
  Title: ({ props }) => (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-muted-foreground">
          Itinerary
        </p>
        <h3 className="text-base font-semibold leading-none tracking-tight text-neutral-900 dark:text-foreground">
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
      <span className="font-mono text-2xl font-semibold tracking-wider text-neutral-900 dark:text-foreground">
        {s(props.code)}
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
  AirlineBadge: ({ props }) => (
    <Badge variant="secondary" className="uppercase tracking-[0.08em]">
      {s(props.name)}
    </Badge>
  ),
  PriceTag: ({ props }) => (
    <div className="flex items-baseline gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-muted-foreground">
        Total
      </span>
      <span className="font-mono text-base font-semibold text-neutral-900 dark:text-foreground">
        {s(props.amount)}
      </span>
    </div>
  ),
  /**
   * Button override: sends the schema's `action` on click and then shows the
   * "Booked" confirmation (see ActionButton above).
   */
  Button: ({ props, children }) => (
    <ActionButton action={props.action}>
      {props.child ? children(props.child) : null}
    </ActionButton>
  ),
};
// @endregion[renderers-tsx]
