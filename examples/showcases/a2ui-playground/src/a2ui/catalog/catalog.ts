"use client";

/**
 * The playground's generative UI (CopilotKit Gen UI 2.0, A2UI 1.0).
 *
 * `standardUI` brings the 69 standard components (Column, Row, Grid, Card,
 * Tabs, Text, Title, Button, TextField, Chart, Map, Table, ...). On top of it
 * sit the playground's own components: KPIs, TanStack charts, MapLibre maps,
 * extra inputs and domain cards. A name may come from only one place
 * (`createGenerativeUI` throws on a duplicate), so the playground's old
 * Column, Card, Button and the rest were dropped for the standard ones.
 *
 * Each of our components renders inside a `display: contents` element that
 * carries its A2UI type, so the build log can find it in the DOM without
 * changing any layout. The standard components get the same marker (`.a2-std`,
 * through `overrides`), so the playground can point at any component on screen
 * from the line that wrote it.
 *
 * `Blueprint` is an internal stand-in the agent emits for a component whose
 * id has arrived but whose props are still streaming (and for every leaf of a
 * fixed template before its data lands). The composer prompt never lists it.
 */
import { createElement, type ComponentType } from "react";
import { createGenerativeUI, standardUI, type GenerativeUITheme } from "@copilotkit/react-core/v2/generative-ui";
import { z } from "zod";
import type { ComponentName } from "./definitions";
import { ownEntries } from "./entries";
import { CATALOG_ID } from "./ids";
import { BlueprintFrame } from "./renderers/blueprint";
import { chartRenderers } from "./renderers/charts";
import { contentRenderers } from "./renderers/content";
import { dataRenderers } from "./renderers/data";
import { domainRenderers } from "./renderers/domain";
import { feedbackRenderers } from "./renderers/feedback";
import { inputRenderers } from "./renderers/inputs";
import { layoutRenderers } from "./renderers/layout";
import { mapRenderers } from "./renderers/maps";
import type { Renderer } from "./renderers/types";

export const renderers: { [K in ComponentName]: Renderer<K> } = {
  ...layoutRenderers,
  ...contentRenderers,
  ...dataRenderers,
  ...chartRenderers,
  ...mapRenderers,
  ...inputRenderers,
  ...feedbackRenderers,
  ...domainRenderers,
};

/** Internal stand-in: `{ component: "Blueprint", of: "Stat", h?: 96 }`. */
export const BLUEPRINT = "Blueprint";
const blueprintSchema = z.object({ of: z.string().optional(), h: z.number().optional(), state: z.string().optional() });

type AnyRender = ComponentType<{ props: Record<string, unknown> }>;

/** Wraps a renderer in its `.a2-node` and turns the `onAction` event into the `action` closure renderers call. */
function node(name: string, Render: AnyRender) {
  function Node(engineProps: Record<string, unknown>) {
    const { onAction, ...rest } = engineProps as { onAction?: (args: object) => Promise<unknown> } & Record<string, unknown>;
    const props = onAction ? { ...rest, action: () => void onAction({}) } : rest;
    return createElement("div", { className: "a2-node", "data-a2-type": name }, createElement(Render, { props }));
  }
  Node.displayName = `A2UI(${name})`;
  return Node;
}

const own = ownEntries((name) => node(name, renderers[name] as unknown as AnyRender));

/**
 * A standard component, unchanged, inside a `display: contents` span with its A2UI type. A span, not a div:
 * standard components can sit inside inline content. `.a2-std` is not `.a2-node`, so the paint-in motion
 * rules for our own components leave it alone.
 */
function marked(name: string, Base: ComponentType<Record<string, unknown>>) {
  function Std(props: Record<string, unknown>) {
    return createElement("span", { className: "a2-std", "data-a2-type": name }, createElement(Base, props));
  }
  Std.displayName = `A2UI(${name})`;
  return Std;
}

const markedStandard = Object.fromEntries(
  [...standardUI.components].map(([name, c]) => [name, { component: marked(name, c.component as unknown as ComponentType<Record<string, unknown>>) }]),
);

export const playgroundUI = createGenerativeUI({
  id: CATALOG_ID,
  extends: [standardUI],
  overrides: markedStandard as never,
  components: {
    ...(own as unknown as Record<ComponentName, { component: ComponentType<never>; props: z.ZodObject<z.ZodRawShape> }>),
    [BLUEPRINT]: { component: node(BLUEPRINT, BlueprintFrame as unknown as AnyRender), props: blueprintSchema },
  },
});

/** The playground's dark palette for the standard components (`--a2ui-*`). */
export const playgroundTheme: GenerativeUITheme = {
  "--a2ui-font-family": "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  dark: {
    "--a2ui-color-surface": "oklch(0.172 0.005 285)",
    "--a2ui-color-surface-secondary": "oklch(0.205 0.006 285)",
    "--a2ui-color-surface-elevated": "oklch(0.205 0.006 285)",
    "--a2ui-color-surface-soft": "oklch(1 0 0 / 3%)",
    "--a2ui-color-panel": "oklch(0.172 0.005 285)",
    "--a2ui-color-border-default": "oklch(1 0 0 / 7.5%)",
    "--a2ui-color-border-subtle": "oklch(1 0 0 / 5%)",
    "--a2ui-color-border-strong": "oklch(1 0 0 / 12%)",
    "--a2ui-color-text-default": "oklch(0.97 0.003 285)",
    "--a2ui-color-text-secondary": "oklch(0.68 0.012 285)",
    "--a2ui-color-accent": "oklch(0.72 0.17 292)",
    "--a2ui-color-on-accent": "oklch(0.16 0.02 292)",
    "--a2ui-chart-1": "oklch(0.72 0.17 292)",
    "--a2ui-chart-2": "oklch(0.76 0.12 225)",
    "--a2ui-chart-3": "oklch(0.79 0.15 162)",
    "--a2ui-chart-4": "oklch(0.83 0.14 78)",
    "--a2ui-chart-5": "oklch(0.71 0.18 12)",
    "--a2ui-chart-6": "oklch(0.7 0.03 285)",
    "--a2ui-radius-lg": "14px",
  },
};
