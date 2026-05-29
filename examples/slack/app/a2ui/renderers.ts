/**
 * A2UI catalog — Slack-specific renderers for the flight surface.
 *
 * Block Kit can't nest blocks, so instead of emitting one section per
 * A2UI leaf (which reads as a stack of text lines), the structural
 * renderers *compose* a card:
 *
 *   - `Row` merges its children onto one line (the route "SFO → JFK").
 *   - `Column` lays the card out: a `header`, a prominent full-width
 *     route line, a 2-column `fields` grid for the remaining details
 *     (airline, price), a divider, then the action button.
 *
 * Leaves (`AirlineBadge`, `PriceTag`) self-label so each grid cell reads
 * "*Label*\nvalue".
 */
import type { KnownBlock } from "@slack/types";
import { createCatalog } from "@copilotkit/slack";
import type { CatalogRenderers } from "@copilotkit/slack";
import { flightDefinitions } from "./definitions.js";
import type { FlightDefinitions } from "./definitions.js";

/**
 * Best-effort extraction of the human text from an already-rendered
 * block, so structural renderers can recompose children into one block.
 */
function blockText(b: KnownBlock): string {
  const any = b as Record<string, any>;
  if (any.text?.text) return String(any.text.text);
  if (Array.isArray(any.elements)) {
    return any.elements
      .map((e: { text?: string }) => e?.text)
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

export const flightRenderers: CatalogRenderers<FlightDefinitions> = {
  // Card { child } — render the single child.
  Card: ({ props, children }) => (props.child ? children(props.child) : []),

  // Column { children } — compose the card layout.
  Column: ({ props, children }) => {
    const kids = props.children as
      | string[]
      | Array<{ id: string; basePath?: string }>;
    const rendered = (kids ?? []).flatMap((c) =>
      typeof c === "string" ? children(c) : children(c.id, c.basePath),
    );

    const headers = rendered.filter((b) => b.type === "header");
    const actions = rendered.filter((b) => b.type === "actions");
    const data = rendered.filter(
      (b) => b.type !== "header" && b.type !== "actions",
    );

    const out: KnownBlock[] = [...headers];

    // First data line (the route) gets a prominent full-width section;
    // the rest become a 2-column fields grid.
    if (data.length > 0) {
      const lead = blockText(data[0]!);
      if (lead) {
        out.push({ type: "section", text: { type: "mrkdwn", text: lead } });
      }
      const fields = data
        .slice(1)
        .map((b) => ({ type: "mrkdwn" as const, text: blockText(b) }))
        .filter((f) => f.text);
      if (fields.length) {
        out.push({ type: "section", fields: fields.slice(0, 10) });
      }
    }

    if (actions.length) {
      out.push({ type: "divider" });
      out.push(...actions);
    }
    return out;
  },

  // Row { children } — horizontal: merge children onto one line.
  Row: ({ props, children }) => {
    const kids = props.children as
      | string[]
      | Array<{ id: string; basePath?: string }>;
    const parts = (kids ?? [])
      .flatMap((c) =>
        typeof c === "string" ? children(c) : children(c.id, c.basePath),
      )
      .map(blockText)
      .filter(Boolean);
    if (!parts.length) return [];
    return [
      { type: "section", text: { type: "mrkdwn", text: parts.join("  ") } },
    ];
  },

  Title: ({ props }) => [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `✈️  ${String(props.text)}`,
        emoji: true,
      },
    },
  ],

  Text: ({ props }) => [
    { type: "section", text: { type: "mrkdwn", text: String(props.text) } },
  ],

  // Bold airport code — feeds Row's merge to form the route line.
  Airport: ({ props }) => [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${String(props.code)}*` },
    },
  ],

  Arrow: () => [{ type: "section", text: { type: "mrkdwn", text: "→" } }],

  // Self-labelled grid cell.
  AirlineBadge: ({ props }) => [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Airline*\n:airplane: ${String(props.name)}`,
      },
    },
  ],

  PriceTag: ({ props }) => [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Price*\n*${String(props.amount)}*` },
    },
  ],

  Button: ({ props, context, children, dispatch }) => {
    // Pull the label out of the child Text component.
    let label = "Submit";
    if (props.child) {
      const childBlocks = children(props.child);
      const firstSection = childBlocks.find(
        (b) => b.type === "section" && (b as any).text?.type === "mrkdwn",
      ) as { text: { text: string } } | undefined;
      if (firstSection) label = stripMrkdwn(firstSection.text.text);
    }

    // `props.action` after binder resolution is `() => void`; reach into
    // the unresolved model for the raw `{ event: { name, context } }`.
    const rawAction = context.componentModel.properties["action"] as
      | { event: { name: string; context?: Record<string, unknown> } }
      | undefined;

    return [
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: `✈️  ${label}`, emoji: true },
            action_id: "a2ui:button",
            // A flight booking is the primary CTA on this card.
            style: "primary" as const,
            ...(rawAction && dispatch
              ? { value: dispatch.encodeAction(rawAction) }
              : {}),
          },
        ],
      },
    ];
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
