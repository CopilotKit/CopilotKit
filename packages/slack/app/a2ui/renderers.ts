/**
 * A2UI catalog — Slack-specific renderers.
 *
 * Each renderer maps a component name from `definitions.ts` to a
 * function that returns Block Kit blocks. Props are type-checked
 * against the Zod schemas in the definitions — `CatalogRenderers<D>`
 * forces an entry per definition with the right prop shape.
 *
 * The Slack analogue of a React `renderers.tsx`. Two notable
 * differences from the React side:
 *
 *   - Block Kit has no native chart primitives. For chart-like
 *     components on a Slack surface, render a text summary (or pick a
 *     different catalog component for the agent to use).
 *   - Interactive elements (Button, FlightCard with action) call
 *     `dispatch.encodeAction({ event })` to pack a payload into a
 *     `button.value` (≤ 2000 chars). On click, the bridge decodes
 *     this and dispatches the action back to the agent — same
 *     plumbing as HITL pickers.
 */
import type { CatalogRenderers } from "../../src/index.js";
import {
  dashboardDefinitions,
  type DashboardDefinitions,
} from "./definitions.js";

// ─── Small helpers ──────────────────────────────────────────────────

const variantEmoji: Record<string, string> = {
  success: ":large_green_circle:",
  warning: ":large_yellow_circle:",
  error: ":red_circle:",
  info: ":large_blue_circle:",
  neutral: ":white_circle:",
};

const trendArrow: Record<string, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
};

// ─── Renderers ──────────────────────────────────────────────────────

export const dashboardRenderers: CatalogRenderers<DashboardDefinitions> = {
  Title: ({ props }) => [
    {
      type: "header",
      text: { type: "plain_text", text: String(props.text), emoji: true },
    },
  ],

  Metric: ({ props }) => {
    const trend =
      props.trend && props.trendValue
        ? ` ${trendArrow[props.trend] ?? ""} ${props.trendValue}`
        : "";
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${props.label}*: ${String(props.value)}${trend}`,
        },
      },
    ];
  },

  Badge: ({ props }) => {
    const emoji = variantEmoji[props.variant ?? "neutral"] ?? "";
    return [
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `${emoji} ${String(props.text)}`.trim() },
        ],
      },
    ];
  },

  FlightCard: ({ props, dispatch }) => {
    // DynString fields type as `string | { path }` from the schema; the
    // bridge resolves bindings before calling the renderer, so at
    // runtime they're always strings. Coerce with `String(...)` to keep
    // the static type happy.
    const airline = String(props.airline);
    const airlineLogo = String(props.airlineLogo);
    const id = String(props.id);

    const body =
      `*${airline}* — ${String(props.flightNumber)}\n` +
      `${String(props.origin)} → ${String(props.destination)} • ${String(props.date)}\n` +
      `${String(props.departureTime)} → ${String(props.arrivalTime)} (${String(props.duration)})\n` +
      `Status: ${String(props.status)} • *${String(props.price)}*`;

    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: body },
        accessory: {
          type: "image",
          image_url: airlineLogo,
          alt_text: airline,
        },
      },
    ];

    if (props.action && dispatch) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Select", emoji: true },
            action_id: `a2ui:flight:${id}`,
            value: dispatch.encodeAction(props.action),
          },
        ],
      });
    }

    return blocks;
  },
};

// Re-export the definitions alongside the renderers so consumers can
// pass both into `createCatalog` from one import.
export { dashboardDefinitions };
