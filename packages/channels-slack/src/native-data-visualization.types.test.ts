import { expect, test } from "vitest";
import { isNativeNode } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { serializeSlackNativeNode } from "./native-codec.js";
import { Slack } from "./native.js";

const chartCases = [
  {
    name: "pie",
    chart: {
      type: "pie",
      segments: [
        { label: "Sunny", value: 5 },
        { label: "Rainy", value: 2 },
      ],
    },
  },
  {
    name: "bar",
    chart: {
      type: "bar",
      series: [
        {
          name: "High",
          data: [
            { label: "Mon", value: 72 },
            { label: "Tue", value: 68 },
          ],
        },
      ],
      axis_config: {
        categories: ["Mon", "Tue"],
        x_label: "Day",
        y_label: "Temperature (F)",
      },
    },
  },
  {
    name: "area",
    chart: {
      type: "area",
      series: [
        {
          name: "Rainfall",
          data: [
            { label: "Mon", value: 0.2 },
            { label: "Tue", value: 0.8 },
          ],
        },
      ],
      axis_config: { categories: ["Mon", "Tue"] },
    },
  },
  {
    name: "line",
    chart: {
      type: "line",
      series: [
        {
          name: "Temperature",
          data: [
            { label: "Mon", value: 62 },
            { label: "Tue", value: 65 },
          ],
        },
      ],
      axis_config: { categories: ["Mon", "Tue"] },
    },
  },
] as const;

const __typeGuards = () => {
  // @ts-expect-error chart is required
  Slack.Block.DataVisualization({ title: "Weather" });
  // @ts-expect-error title is required
  Slack.Block.DataVisualization({
    chart: { type: "pie", segments: [{ label: "Sunny", value: 1 }] },
  });
  Slack.Block.DataVisualization({
    title: "Weather",
    chart: {
      // @ts-expect-error scatter is not a supported chart type
      type: "scatter",
      series: [],
      axis_config: { categories: [] },
    },
  });
  Slack.Block.DataVisualization({
    title: "Weather",
    // @ts-expect-error pie charts require segments
    chart: { type: "pie" },
  });
  Slack.Block.DataVisualization({
    title: "Weather",
    // @ts-expect-error series charts require axis_config
    chart: { type: "line", series: [] },
  });
  Slack.Block.DataVisualization({
    title: "Weather",
    chart: { type: "pie", segments: [{ label: "Sunny", value: 1 }] },
    // @ts-expect-error data visualization blocks do not accept children
    children: Slack.Block.Divider({}),
  });
};
void __typeGuards;

test.each(chartCases)(
  "Slack data visualization serializes a $name chart",
  ({ chart }) => {
    const node = Slack.Block.DataVisualization({
      title: "Weekly weather",
      chart,
    });

    expect(serialize(node)).toEqual({
      type: "data_visualization",
      title: "Weekly weather",
      chart,
    });
  },
);

function serialize(node: ChannelNode): Record<string, unknown> {
  expect(isNativeNode(node)).toBe(true);
  if (!isNativeNode(node)) throw new TypeError("expected native Slack node");
  return serializeSlackNativeNode(node);
}
