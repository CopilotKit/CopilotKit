/**
 * A2UI catalog — Slack-specific renderers for the flight surface.
 *
 * Each renderer maps a component name from `definitions.ts` to a
 * function returning Block Kit blocks. Structural components (Card,
 * Column, Row) flatten their children — Slack's block stack is
 * vertical anyway, so visual rows/columns map to plain block ordering.
 *
 * Text-equivalent components (Airport, AirlineBadge, PriceTag) emit
 * a single section block with semantic styling. The whole flight
 * surface ends up as ~4-5 section blocks the user can read at a
 * glance in Slack.
 */
import { createCatalog, type CatalogRenderers } from "../../src/index.js";
import { flightDefinitions, type FlightDefinitions } from "./definitions.js";

export const flightRenderers: CatalogRenderers<FlightDefinitions> = {
  // Card { child } — pass-through to the single child.
  Card: ({ props, children }) => (props.child ? children(props.child) : []),

  // Column / Row { children: id[] | template } — flatten children.
  Column: ({ props, children }) => {
    const kids = props.children as
      | string[]
      | Array<{ id: string; basePath?: string }>;
    return (kids ?? []).flatMap((c) =>
      typeof c === "string" ? children(c) : children(c.id, c.basePath),
    );
  },

  Row: ({ props, children }) => {
    // In Slack, Row is purely structural — we flatten its children
    // into the same vertical block stack. The visual layout hint
    // (justify/align) is irrelevant.
    const kids = props.children as
      | string[]
      | Array<{ id: string; basePath?: string }>;
    return (kids ?? []).flatMap((c) =>
      typeof c === "string" ? children(c) : children(c.id, c.basePath),
    );
  },

  Title: ({ props }) => [
    {
      type: "header",
      text: { type: "plain_text", text: String(props.text), emoji: true },
    },
  ],

  Text: ({ props }) => [
    {
      type: "section",
      text: { type: "mrkdwn", text: String(props.text) },
    },
  ],

  Airport: ({ props }) => [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${String(props.code)}*` },
    },
  ],

  Arrow: () => [
    {
      type: "section",
      text: { type: "mrkdwn", text: "→" },
    },
  ],

  AirlineBadge: ({ props }) => [
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `:airplane: *${String(props.name)}*` },
      ],
    },
  ],

  PriceTag: ({ props }) => [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${String(props.amount)}*` },
    },
  ],

  Button: ({ props, context, children, dispatch }) => {
    // Pull the label out of the child Text component. We render the
    // child to a block and extract its text, then wrap in an actions
    // block with a real Slack button (Block Kit doesn't compose
    // arbitrary blocks inside a button — it's plain_text only).
    let label = "Submit";
    if (props.child) {
      const childBlocks = children(props.child);
      const firstSection = childBlocks.find(
        (b) => b.type === "section" && (b as any).text?.type === "mrkdwn",
      ) as { text: { text: string } } | undefined;
      if (firstSection) label = stripMrkdwn(firstSection.text.text);
    }

    // `props.action` after binder resolution is `() => void`; we need
    // the raw `{ event: { name, context } }` JSON to encode into
    // button.value, so reach into the unresolved component model.
    const rawAction = context.componentModel.properties["action"] as
      | { event: { name: string; context?: Record<string, unknown> } }
      | undefined;

    const elements: any[] = [
      {
        type: "button",
        text: { type: "plain_text", text: label, emoji: true },
        action_id: "a2ui:button",
        ...(rawAction && dispatch
          ? { value: dispatch.encodeAction(rawAction) }
          : {}),
        ...(props.variant === "primary" ? { style: "primary" as const } : {}),
      },
    ];
    return [{ type: "actions", elements }];
  },
};

// Strip the most common mrkdwn markers so a "Book flight" rendered as
// `*Book flight*` becomes "Book flight" inside a plain_text button.
function stripMrkdwn(s: string): string {
  return s.replace(/\*([^*]+)\*/g, "$1").replace(/_([^_]+)_/g, "$1");
}

export { flightDefinitions };

export const flightCatalog = createCatalog(
  flightDefinitions,
  flightRenderers,
  // catalogId must match CATALOG_ID in
  // `packages/slack/agent/src/agents/a2ui_fixed.py`.
  { catalogId: "copilotkit://flight-fixed-catalog" },
);
