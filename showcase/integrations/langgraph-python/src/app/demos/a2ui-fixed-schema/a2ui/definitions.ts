/**
 * Generative UI component DEFINITIONS — platform-agnostic.
 *
 * Each entry declares a component name + its Zod props schema. The standard
 * catalog (Card, Column, Row, Text, Button, …) ships with CopilotKit and
 * is mixed in via `extends: [standardUI]` in `./catalog.ts`, so we only
 * declare the project-specific additions and the visual overrides here.
 * (`./catalog.ts` omits the standard components that these entries replace.)
 *
 * Path bindings: fields that the fixed schema JSON binds to a data-model
 * path (e.g. `{ path: "/origin" }`) are plain `z.string()`. CopilotKit
 * resolves the binding before render, so the renderer only ever sees the
 * resolved string.
 */
// @region[definitions-types]
import { z } from "zod";
import { child } from "@copilotkit/react-core/generative-ui";

/** A string the fixed schema may bind to a data-model path. */
const DynString = z.string();

export const definitions = {
  /**
   * Card override: gives the outer flight-card container a ShadCN look
   * (rounded-xl, neutral-200 border, soft shadow). The standard
   * Card uses inline styles; overriding here lets the demo's renderer
   * adopt the demo's Tailwind aesthetic without touching the schema JSON.
   */
  Card: {
    description: "A container card with a single child.",
    props: z.object({
      child: child(),
    }),
  },
  Title: {
    description: "A prominent heading for the flight card.",
    props: z.object({
      text: DynString,
    }),
  },
  Airport: {
    description: "A 3-letter airport code, displayed large.",
    props: z.object({
      code: DynString,
    }),
  },
  Arrow: {
    description: "A right-pointing arrow used between airports.",
    props: z.object({}),
  },
  AirlineBadge: {
    description: "A pill-styled airline name tag.",
    props: z.object({
      name: DynString,
    }),
  },
  PriceTag: {
    description: "A stylized price display (e.g. '$289').",
    props: z.object({
      amount: DynString,
    }),
  },
  /**
   * Button override: swaps in an ActionButton renderer that tracks
   * its own `done` state so clicking "Book flight" visually updates to
   * a "Booked ✓" confirmation. The standard Button is stateless,
   * so without this override the click fires the action but the button
   * looks unchanged. Mirrors the pattern in beautiful-chat
   * (src/app/demos/beautiful-chat/declarative-generative-ui/renderers.tsx).
   */
  Button: {
    description:
      "An interactive button with an action event. Use 'child' with a Text component ID for the label. After click, the button shows a confirmation state.",
    props: z.object({
      child: child("The ID of the child component (e.g. a Text component for the label)."),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
    }),
    events: { onClick: { parameters: z.object({}) } },
  },
};
// @endregion[definitions-types]

export type Definitions = typeof definitions;
