import { z } from "zod";
import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/angular/generative-ui";
import type { GenerativeUI } from "@copilotkit/angular/generative-ui";

import {
  BeautifulBadgeComponent,
  BeautifulBarChartComponent,
  BeautifulButtonComponent,
  BeautifulColumnComponent,
  BeautifulDashboardCardComponent,
  BeautifulDataTableComponent,
  BeautifulFlightCardComponent,
  BeautifulMetricComponent,
  BeautifulPieChartComponent,
  BeautifulRowComponent,
  BeautifulTitleComponent,
} from "./beautiful-components";
import {
  DeclarativeBarChartComponent,
  DeclarativeCardComponent,
  DeclarativeColumnComponent,
  DeclarativeDataTableComponent,
  DeclarativeInfoRowComponent,
  DeclarativeMetricComponent,
  DeclarativePieChartComponent,
  DeclarativePrimaryButtonComponent,
  DeclarativeRowComponent,
  DeclarativeStatusBadgeComponent,
  DeclarativeTextComponent,
} from "./declarative-components";
import {
  FixedAirlineBadgeComponent,
  FixedAirportComponent,
  FixedArrowComponent,
  FixedButtonComponent,
  FixedCardComponent,
  FixedPriceTagComponent,
  FixedTitleComponent,
} from "./fixed-components";

// Each UI keeps the catalog id that the showcase agents put on their
// surfaces. The agents write A2UI v0.9, which the runtime converts to 1.0:
// a binding such as `{ "@path": "/origin" }` arrives resolved, so props are
// plain types, and a `Button` action arrives as `onClick`. Components that
// replace a standard one (Row, Card, Button, ...) are omitted from
// `standardUI` first, so they keep the props the agents send.

const chartDatum = z.object({ label: z.string(), value: z.number() });
const align = z.enum(["start", "center", "end", "stretch", "baseline"]);
const cardProps = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
});
const metricProps = z.object({
  label: z.string(),
  value: z.string(),
  trend: z.enum(["up", "down", "neutral"]).optional(),
  trendValue: z.string().optional(),
});
const tableColumns = z.array(z.object({ key: z.string(), label: z.string() }));
const titledChartProps = z.object({
  title: z.string(),
  description: z.string(),
  data: z.array(chartDatum),
});
const buttonProps = z.object({
  variant: z.enum(["primary", "secondary", "ghost"]).optional(),
});
const noArgs = z.object({});
const clickEvent = {
  onClick: { description: "Sent when the user clicks", parameters: noArgs },
};

const declarativeUI = createGenerativeUI({
  id: "declarative-gen-ui-catalog",
  extends: [standardUI.omit(["Row", "Column", "Text", "Card"])],
  components: {
    Row: {
      component: DeclarativeRowComponent,
      description: "A horizontal row of children.",
      props: z.object({
        gap: z.number().optional(),
        align: align.optional(),
        justify: z.enum(["start", "center", "end", "spaceBetween"]).optional(),
      }),
      slots: { children: "multiple" },
    },
    Column: {
      component: DeclarativeColumnComponent,
      description: "A vertical column of children.",
      props: z.object({
        gap: z.number().optional(),
        align: align.optional(),
      }),
      slots: { children: "multiple" },
    },
    Text: {
      component: DeclarativeTextComponent,
      description: "A paragraph of text.",
      props: z.object({ text: z.string() }),
    },
    Card: {
      component: DeclarativeCardComponent,
      description: "A titled card with an optional subtitle and one child.",
      props: cardProps,
      slots: { child: "single" },
    },
    StatusBadge: {
      component: DeclarativeStatusBadgeComponent,
      description: "A coloured pill for the state of something.",
      props: z.object({
        text: z.string(),
        variant: z.enum(["success", "warning", "error", "info"]).optional(),
      }),
    },
    Metric: {
      component: DeclarativeMetricComponent,
      description: "A KPI tile with an optional trend.",
      props: metricProps,
    },
    InfoRow: {
      component: DeclarativeInfoRowComponent,
      description: "A compact 'label: value' row.",
      props: z.object({ label: z.string(), value: z.string() }),
    },
    DataTable: {
      component: DeclarativeDataTableComponent,
      description: "A table with labelled columns.",
      props: z.object({
        columns: tableColumns,
        rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
      }),
    },
    PrimaryButton: {
      component: DeclarativePrimaryButtonComponent,
      description: "A primary button with a label.",
      props: z.object({ label: z.string() }),
      events: {
        action: {
          description: "Sent when the user clicks",
          parameters: noArgs,
        },
      },
    },
    PieChart: {
      component: DeclarativePieChartComponent,
      description: "A donut chart of { label, value } pairs.",
      props: titledChartProps,
    },
    BarChart: {
      component: DeclarativeBarChartComponent,
      description: "A bar chart of { label, value } pairs.",
      props: titledChartProps,
    },
  },
});

// @region[a2ui-fixed-schema]
const fixedUI = createGenerativeUI({
  id: "copilotkit://flight-fixed-catalog",
  extends: [standardUI.omit(["Card", "Title", "Button"])],
  components: {
    Card: {
      component: FixedCardComponent,
      description: "The flight card around one child.",
      slots: { child: "single" },
    },
    Title: {
      component: FixedTitleComponent,
      description: "The title of the flight card.",
      props: z.object({ text: z.string() }),
    },
    Airport: {
      component: FixedAirportComponent,
      description: "An airport by IATA code.",
      props: z.object({ code: z.string() }),
    },
    Arrow: {
      component: FixedArrowComponent,
      description: "An arrow between two airports.",
    },
    AirlineBadge: {
      component: FixedAirlineBadgeComponent,
      description: "The name of the airline.",
      props: z.object({ name: z.string() }),
    },
    PriceTag: {
      component: FixedPriceTagComponent,
      description: "The price of the flight.",
      props: z.object({ amount: z.string() }),
    },
    Button: {
      component: FixedButtonComponent,
      description: "A button with one child as its label.",
      props: buttonProps,
      slots: { child: "single" },
      events: clickEvent,
    },
  },
});
// @endregion[a2ui-fixed-schema]

const beautifulUI = createGenerativeUI({
  id: "copilotkit://app-dashboard-catalog",
  extends: [standardUI.omit(["Title", "Row", "Column", "Badge", "Button"])],
  components: {
    Title: {
      component: BeautifulTitleComponent,
      description: "A dashboard heading.",
      props: z.object({ text: z.string(), level: z.string().optional() }),
    },
    Row: {
      component: BeautifulRowComponent,
      description: "A horizontal row of children.",
      props: z.object({
        gap: z.number().optional(),
        align: z.string().optional(),
        justify: z.string().optional(),
      }),
      slots: { children: "multiple" },
    },
    Column: {
      component: BeautifulColumnComponent,
      description: "A vertical column of children.",
      props: z.object({
        gap: z.number().optional(),
        align: z.string().optional(),
      }),
      slots: { children: "multiple" },
    },
    DashboardCard: {
      component: BeautifulDashboardCardComponent,
      description: "A titled card with an optional subtitle and one child.",
      props: cardProps,
      slots: { child: "single" },
    },
    Metric: {
      component: BeautifulMetricComponent,
      description: "A KPI tile with an optional trend.",
      props: metricProps,
    },
    PieChart: {
      component: BeautifulPieChartComponent,
      description: "A pie chart of { label, value } pairs.",
      props: z.object({
        data: z.array(chartDatum.extend({ color: z.string().optional() })),
        innerRadius: z.number().optional(),
      }),
    },
    BarChart: {
      component: BeautifulBarChartComponent,
      description: "A bar chart of { label, value } pairs.",
      props: z.object({
        data: z.array(chartDatum),
        color: z.string().optional(),
      }),
    },
    Badge: {
      component: BeautifulBadgeComponent,
      description: "A small status pill.",
      props: z.object({
        text: z.string(),
        variant: z
          .enum(["success", "warning", "error", "info", "neutral"])
          .optional(),
      }),
    },
    DataTable: {
      component: BeautifulDataTableComponent,
      description: "A table with labelled columns.",
      props: z.object({
        columns: tableColumns,
        rows: z.array(z.record(z.string(), z.unknown())),
      }),
    },
    Button: {
      component: BeautifulButtonComponent,
      description: "A button with one child as its label.",
      props: buttonProps,
      slots: { child: "single" },
      events: clickEvent,
    },
    FlightCard: {
      component: BeautifulFlightCardComponent,
      description: "A flight with times, route, status and price.",
      props: z.object({
        airline: z.string(),
        airlineLogo: z.string(),
        flightNumber: z.string(),
        origin: z.string(),
        destination: z.string(),
        date: z.string(),
        departureTime: z.string(),
        arrivalTime: z.string(),
        duration: z.string(),
        status: z.string(),
        statusColor: z.string().optional(),
        price: z.string(),
      }),
      events: {
        action: {
          description: "Sent when the user picks it",
          parameters: noArgs,
        },
      },
    },
  },
});

/** Select the generative UI catalog for a demo route. */
// @region[a2ui-schema-and-recovery]
export function generativeUIForFeature(
  feature: string,
): GenerativeUI | undefined {
  switch (feature) {
    case "beautiful-chat":
      return beautifulUI;
    case "declarative-gen-ui":
    case "a2ui-recovery":
      return declarativeUI;
    case "a2ui-fixed-schema":
      return fixedUI;
    default:
      return undefined;
  }
}
// @endregion[a2ui-schema-and-recovery]
