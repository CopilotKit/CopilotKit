"use client";

/**
 * The app's generative UI (CopilotKit Gen UI 2.0, A2UI 1.0).
 * Copied from a2ui-playground `src/a2ui/catalog/catalog.ts`; adapt the imports.
 *
 * `standardUI` brings the 69 standard components (Column, Row, Grid, Card,
 * Tabs, Text, Title, Button, TextField, Chart, Map, Table, ...). On top of it
 * sit the app's own components. A name may come from only one place:
 * `createGenerativeUI` throws when a name is both in a base and in
 * `components`. Use the standard one, drop it with `standardUI.omit([...])`,
 * or swap its React component with `overrides`.
 *
 * Each own component renders inside a `display: contents` element that
 * carries its A2UI type, so a build log can find it in the DOM without
 * changing any layout (Gen UI 2.0 does not hand a component its id; see
 * node-rects.ts).
 *
 * `Blueprint` is an internal stand-in the agent emits for a component whose
 * id has arrived but whose props are still streaming (and for every leaf of a
 * fixed template before its data lands). The composer prompt never lists it.
 */
import { createElement, type ComponentType } from "react";
import { createGenerativeUI, standardUI, type GenerativeUITheme } from "@copilotkit/react-core/v2/generative-ui";
import { z } from "zod";
import { definitions, type ComponentName } from "./definitions";
import { CATALOG_ID } from "./ids";
import { BlueprintFrame } from "./renderers/blueprint";
import { renderers } from "./renderers"; // { [K in ComponentName]: Renderer<K> }, see renderer-types.ts

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

const own = Object.fromEntries(
  (Object.keys(definitions) as ComponentName[]).map((name) => {
    const d = definitions[name];
    return [
      name,
      {
        component: node(name, renderers[name] as unknown as AnyRender),
        description: d.description,
        props: d.props,
        ...("events" in d && d.events ? { events: d.events } : {}),
        ...("writable" in d && d.writable ? { writable: d.writable } : {}),
      },
    ];
  }),
);

export const playgroundUI = createGenerativeUI({
  id: CATALOG_ID,
  extends: [standardUI],
  components: {
    ...(own as unknown as Record<ComponentName, { component: ComponentType<never>; props: z.ZodObject<z.ZodRawShape> }>),
    [BLUEPRINT]: { component: node(BLUEPRINT, BlueprintFrame as unknown as AnyRender), props: blueprintSchema },
  },
});

/** Palette for the standard components (`--a2ui-*`). `dark` applies under a `.dark` class. */
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
