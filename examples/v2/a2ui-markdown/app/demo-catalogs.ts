import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";

type StandardComponent = keyof NonNullable<
  typeof standardUI.definitions
>["components"];

/** An allowlist keeps new standard components out until deliberately included. */
export const CHARTING_COMPONENTS = [
  "Chart",
  "Box",
  "Column",
  "Row",
  "Grid",
  "GridItem",
  "Divider",
  "Title",
  "Text",
  "Caption",
  "Badge",
] as const satisfies readonly StandardComponent[];

type ExcludedComponent = Exclude<
  StandardComponent,
  (typeof CHARTING_COMPONENTS)[number]
>;

const chartingNames = new Set<string>(CHARTING_COMPONENTS);
const excluded = [...standardUI.components.keys()].filter(
  (name): name is ExcludedComponent => !chartingNames.has(name),
);

export const chartingUI = createGenerativeUI({
  id: "demo/charting@1",
  extends: [standardUI.omit(excluded)],
  components: {},
});

export const DEMO_CATALOGS = { general: standardUI, charting: chartingUI };

export const CHARTING_SUGGESTIONS = [
  {
    title: "Revenue trend",
    message:
      "Show a line chart of monthly revenue over the last 12 months, with a clear title, currency formatting and a short note about the trend. Use illustrative data.",
  },
  {
    title: "Regional sales",
    message:
      "Compare quarterly sales for North America, Europe and Asia in a grouped bar chart. Use illustrative data, label both axes and show a legend.",
  },
  {
    title: "Expense breakdown",
    message:
      "Show a donut chart of a monthly budget split across housing, food, transport, leisure and savings. Use illustrative data and identify the largest expense.",
  },
  {
    title: "Traffic mix",
    message:
      "Show a stacked area chart of weekly website visits from organic search, paid ads and referrals over eight weeks. Use illustrative data, a legend and a short takeaway.",
  },
  {
    title: "Spend vs. revenue",
    message:
      "Show a scatter chart comparing advertising spend and revenue for 12 campaigns. Use illustrative data and label the axes clearly.",
  },
  {
    title: "Compare chart types",
    message:
      "Show the same six months of illustrative revenue data as a bar chart and a line chart side by side. Use consistent scales and explain briefly what each view makes easier to see.",
  },
];
