/**
 * Worked examples of good surfaces from this catalog, as A2UI v1.0 messages.
 * The generated skills show them to a model (in Express or JSON), so an agent
 * outside the playground sees what a finished answer looks like.
 */
import { A2UI_VERSION } from "@copilotkit/shared";
import { CATALOG_ID } from "./ids";

type Message = Record<string, unknown>;

const surface = (
  surfaceId: string,
  components: Array<Record<string, unknown>>,
  dataModel?: Record<string, unknown>,
): Message[] => [
  {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId,
      catalogId: CATALOG_ID,
      components,
      ...(dataModel ? { dataModel } : {}),
    },
  },
];

const ev = (name: string, context: Record<string, unknown>) => ({
  event: { name, context },
});

export const CATALOG_EXAMPLES: Record<string, Message[]> = {
  "sales-dashboard": surface(
    "sales-dashboard",
    [
      {
        id: "root",
        component: "Column",
        gap: 3,
        children: ["head", "kpis", "chart", "form", "note"],
      },
      {
        id: "head",
        component: "Heading",
        text: "Q3 sales by region",
        eyebrow: "Sales dashboard",
        subtitle: "Revenue grew 11% on EMEA renewals",
      },
      {
        id: "kpis",
        component: "Grid",
        columns: 3,
        children: ["k1", "k2", "k3"],
      },
      {
        id: "k1",
        component: "Stat",
        label: "Revenue",
        value: "$18.4M",
        delta: "+11.2%",
        trend: "up",
      },
      {
        id: "k2",
        component: "Stat",
        label: "Units sold",
        value: "128k",
        delta: "+8.4%",
        trend: "up",
      },
      {
        id: "k3",
        component: "Stat",
        label: "Quota attainment",
        value: "104%",
        delta: "+3 pts",
        trend: "up",
      },
      {
        id: "chart",
        component: "BarChart",
        title: "Revenue by region",
        format: "currency",
        data: [
          { x: "NA", y: 7.1 },
          { x: "EMEA", y: 5.2 },
          { x: "APAC", y: 3.9 },
          { x: "LATAM", y: 2.2 },
        ],
      },
      { id: "form", component: "Card", children: ["ft", "email", "send"] },
      {
        id: "ft",
        component: "Title",
        text: "Get the weekly report",
        size: "md",
      },
      {
        id: "email",
        component: "TextField",
        label: "Work email",
        value: { "@path": "/form/email" },
      },
      {
        id: "send",
        component: "Button",
        label: "Subscribe",
        variant: "primary",
        onClick: ev("subscribe", { email: { "@path": "/form/email" } }),
      },
      { id: "note", component: "Caption", text: "Illustrative data" },
    ],
    { form: { email: "" } },
  ),
  "product-comparison": surface("product-comparison", [
    { id: "root", component: "Column", gap: 3, children: ["head", "grid"] },
    {
      id: "head",
      component: "Heading",
      text: "Noise-cancelling headphones",
      eyebrow: "Compare",
      subtitle: "Three picks under $400, best value first",
    },
    { id: "grid", component: "Grid", columns: 3, children: ["p1", "p2", "p3"] },
    {
      id: "p1",
      component: "ProductCard",
      name: "Studio Wireless",
      price: "$249",
      compareAt: "$329",
      rating: 4.6,
      badge: "Best value",
      specs: ["Adaptive noise cancelling", "40 h battery"],
      onAction: ev("add_to_cart", { sku: "studio" }),
    },
    {
      id: "p2",
      component: "ProductCard",
      name: "Aria Pro 2",
      price: "$349",
      rating: 4.8,
      badge: "Top rated",
      specs: ["Best-in-class ANC", "Spatial audio"],
      onAction: ev("add_to_cart", { sku: "aria" }),
    },
    {
      id: "p3",
      component: "ProductCard",
      name: "Fold Lite",
      price: "$129",
      rating: 4.2,
      specs: ["Foldable, 190 g", "50 h battery"],
      onAction: ev("add_to_cart", { sku: "fold" }),
    },
  ]),
  "live-weather": surface("live-weather", [
    { id: "root", component: "Column", gap: 3, children: ["head", "w"] },
    {
      id: "head",
      component: "Heading",
      text: "Lisbon this week",
      eyebrow: "Live weather",
    },
    { id: "w", component: "WeatherReport", location: "Lisbon" },
  ]),
};
