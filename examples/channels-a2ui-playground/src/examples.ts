import { marketSnapshotProps } from "./poc/market-snapshot.fixture.js";

export const marketSnapshotPlaygroundInput = {
  surfaceId: "s1",
  components: [
    {
      id: "root",
      component: "MarketSnapshot",
      ...marketSnapshotProps,
    },
  ],
} as const;

export const PLAYGROUND_EXAMPLES: Array<{
  id: string;
  label: string;
  description: string;
  input: unknown;
}> = [
  {
    id: "market-snapshot",
    label: "Market snapshot",
    description:
      "Full market fixture from the A2UI POC lowered into the Slack preview renderer.",
    input: marketSnapshotPlaygroundInput,
  },
  {
    id: "basic-text-button",
    label: "Text and button",
    description:
      "Minimal basic-catalog example with a data-bound button action context.",
    input: {
      surfaceId: "basic",
      components: [
        { id: "root", component: "Column", children: ["title", "button"] },
        { id: "title", component: "Text", text: "Status ready", variant: "h2" },
        { id: "label", component: "Text", text: "Retry" },
        {
          id: "button",
          component: "Button",
          child: "label",
          variant: "primary",
          action: {
            event: {
              name: "retry",
              context: { service: { path: "/service" } },
            },
          },
        },
      ],
      data: { service: "api" },
    },
  },
  {
    id: "unsupported-component",
    label: "Unsupported component",
    description:
      "Shows the diagnostic path for components Slack cannot render.",
    input: {
      surfaceId: "unsupported",
      components: [{ id: "root", component: "Divider", axis: "vertical" }],
    },
  },
];
