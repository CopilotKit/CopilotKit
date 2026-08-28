import {
  Actions,
  Button,
  Cell,
  Context,
  Divider,
  Header,
  Message,
  Row,
  Section,
  Table,
} from "@copilotkit/channels";
import type { ClickHandler, Renderable } from "@copilotkit/channels";
import { createChannelA2UICatalog } from "@copilotkit/channels/a2ui";
import { z } from "zod";

export interface MarketRow {
  readonly name: string;
  readonly price: string;
  readonly change: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export interface MarketSnapshotProps {
  readonly headline: string;
  readonly summary: string;
  readonly markets: readonly MarketRow[];
  readonly whyItMatters: string;
  readonly searchedAt: string;
}

export function renderMarketSnapshot(
  props: MarketSnapshotProps,
  onAcknowledge?: ClickHandler,
): Renderable {
  const acknowledge = Button({
    children: "Acknowledge",
    style: "primary",
    onClick: onAcknowledge,
  });
  return Message({
    fallbackText: props.headline,
    children: [
      Header({ children: props.headline }),
      Section({ children: props.summary }),
      Table({
        columns: [
          { header: "Market" },
          { header: "Price", align: "right" },
          { header: "Move", align: "right" },
          { header: "Source" },
        ],
        children: props.markets.map((market) =>
          Row({
            children: [
              Cell({ children: market.name }),
              Cell({ children: market.price }),
              Cell({ children: market.change }),
              Cell({ children: `[${market.sourceName}](${market.sourceUrl})` }),
            ],
          }),
        ),
      }),
      Divider({}),
      Section({ children: `**Why it matters**\n${props.whyItMatters}` }),
      Context({ children: `Searched ${props.searchedAt}` }),
      Actions({
        children: { ...acknowledge, key: "acknowledge-search-result" },
      }),
    ],
  });
}

export function createMarketSnapshotCatalog() {
  const market = z
    .object({
      name: z.string().describe("Short market or contract label."),
      price: z
        .string()
        .describe("Current grounded price including currency and unit."),
      change: z
        .string()
        .describe("Latest grounded percentage or absolute move."),
      sourceName: z.string().describe("Publisher or exchange for this row."),
      sourceUrl: z.string().url().describe("Canonical absolute source URL."),
    })
    .strict();

  return createChannelA2UICatalog(
    {
      MarketSnapshot: {
        description:
          "Complete root-capable live market snapshot for exactly three related instruments. Renders its own headline, sourced table, analysis, timestamp, and Acknowledge action.",
        props: z
          .object({
            headline: z.string().describe("Short combined snapshot headline."),
            summary: z.string().describe("One concise grounded summary."),
            markets: z
              .array(market)
              .length(3)
              .describe("Exactly three related grounded market rows."),
            whyItMatters: z
              .string()
              .describe("Why the combined movement matters."),
            searchedAt: z
              .string()
              .datetime({ offset: true })
              .describe("UTC ISO 8601 search time."),
          })
          .strict(),
      },
    },
    {
      MarketSnapshot: ({ props, dispatch }) =>
        renderMarketSnapshot(props, (interaction) =>
          dispatch(
            { event: { name: "acknowledge_search_result" } },
            interaction,
          ),
        ),
    },
    { catalogId: "copilotkit://channels-market-snapshot/v1" },
  );
}
