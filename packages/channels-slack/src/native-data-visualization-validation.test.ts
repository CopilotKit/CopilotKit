import { expect, test } from "vitest";
import { createNativeNode } from "@copilotkit/channels-ui";
import { serializeSlackNativeNode } from "./native-codec.js";

const validationCases: readonly {
  readonly name: string;
  readonly props: () => Record<string, unknown>;
  readonly error: RegExp;
}[] = [
  {
    name: "rejects a non-string title",
    props: () => ({ ...pieProps(), title: 72 }),
    error: /DataVisualization\.title must be a string/u,
  },
  {
    name: "rejects a title longer than 50 characters",
    props: () => ({ ...pieProps(), title: "x".repeat(51) }),
    error: /DataVisualization\.title must be at most 50 characters/u,
  },
  {
    name: "rejects a non-object chart",
    props: () => ({ title: "Weather", chart: [] }),
    error: /DataVisualization\.chart must be an object/u,
  },
  {
    name: "rejects an unsupported chart type",
    props: () => ({ title: "Weather", chart: { type: "scatter" } }),
    error: /DataVisualization\.chart\.type must be pie, bar, area, or line/u,
  },
  {
    name: "rejects an empty pie segment list",
    props: () => ({ title: "Weather", chart: { type: "pie", segments: [] } }),
    error: /chart\.segments must contain 1 to 12 items/u,
  },
  {
    name: "rejects more than 12 pie segments",
    props: () => ({
      title: "Weather",
      chart: {
        type: "pie",
        segments: Array.from({ length: 13 }, (_, index) => ({
          label: `Day ${index}`,
          value: index + 1,
        })),
      },
    }),
    error: /chart\.segments must contain 1 to 12 items/u,
  },
  {
    name: "rejects a non-object pie segment",
    props: () => ({
      title: "Weather",
      chart: { type: "pie", segments: ["Sunny"] },
    }),
    error: /segments\[0\] must be an object/u,
  },
  {
    name: "rejects a non-string pie segment label",
    props: () => ({
      title: "Weather",
      chart: { type: "pie", segments: [{ label: 1, value: 1 }] },
    }),
    error: /segments\[0\]\.label must be a string/u,
  },
  {
    name: "rejects a pie segment label longer than 20 characters",
    props: () => ({
      title: "Weather",
      chart: {
        type: "pie",
        segments: [{ label: "x".repeat(21), value: 1 }],
      },
    }),
    error: /segments\[0\]\.label must be at most 20 characters/u,
  },
  {
    name: "rejects a non-numeric pie segment value",
    props: () => ({
      title: "Weather",
      chart: { type: "pie", segments: [{ label: "Sunny", value: "five" }] },
    }),
    error: /segments\[0\]\.value must be a finite number/u,
  },
  {
    name: "rejects a non-finite pie segment value",
    props: () => ({
      title: "Weather",
      chart: { type: "pie", segments: [{ label: "Sunny", value: NaN }] },
    }),
    error: /segments\[0\]\.value must be a finite number/u,
  },
  {
    name: "rejects a non-positive pie segment value",
    props: () => ({
      title: "Weather",
      chart: { type: "pie", segments: [{ label: "Sunny", value: 0 }] },
    }),
    error: /segments\[0\]\.value must be greater than 0/u,
  },
  {
    name: "rejects an empty data series list",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /chart\.series must contain 1 to 12 items/u,
  },
  {
    name: "rejects more than 12 data series",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: Array.from({ length: 13 }, (_, index) => ({
          name: `Series ${index}`,
          data: [{ label: "Mon", value: index }],
        })),
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /chart\.series must contain 1 to 12 items/u,
  },
  {
    name: "rejects a non-object data series",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: ["Temperature"],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /series\[0\] must be an object/u,
  },
  {
    name: "rejects a non-string series name",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: 1, data: [{ label: "Mon", value: 5 }] }],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /series\[0\]\.name must be a string/u,
  },
  {
    name: "rejects a series name longer than 20 characters",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "x".repeat(21), data: [{ label: "Mon", value: 5 }] }],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /series\[0\]\.name must be at most 20 characters/u,
  },
  {
    name: "rejects duplicate series names",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [
          { name: "Temperature", data: [{ label: "Mon", value: 5 }] },
          { name: "Temperature", data: [{ label: "Mon", value: 6 }] },
        ],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /chart\.series names must be unique/u,
  },
  {
    name: "rejects an empty data point list",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [] }],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /series\[0\]\.data must contain 1 to 20 items/u,
  },
  {
    name: "rejects more than 20 data points",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [
          {
            name: "Temperature",
            data: Array.from({ length: 21 }, (_, index) => ({
              label: `D${index}`,
              value: index,
            })),
          },
        ],
        axis_config: {
          categories: Array.from({ length: 21 }, (_, index) => `D${index}`),
        },
      },
    }),
    error: /series\[0\]\.data must contain 1 to 20 items/u,
  },
  {
    name: "rejects a non-object data point",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [5] }],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /data\[0\] must be an object/u,
  },
  {
    name: "rejects a missing axis config",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: "Mon", value: 5 }] }],
      },
    }),
    error: /chart\.axis_config must be an object/u,
  },
  {
    name: "rejects a non-object axis config",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: "Mon", value: 5 }] }],
        axis_config: [],
      },
    }),
    error: /chart\.axis_config must be an object/u,
  },
  {
    name: "rejects a missing category list",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: "Mon", value: 5 }] }],
        axis_config: {},
      },
    }),
    error: /axis_config\.categories must contain 1 to 20 items/u,
  },
  {
    name: "rejects an empty category list",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: "Mon", value: 5 }] }],
        axis_config: { categories: [] },
      },
    }),
    error: /axis_config\.categories must contain 1 to 20 items/u,
  },
  {
    name: "rejects a non-string category",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: "Mon", value: 5 }] }],
        axis_config: { categories: [1] },
      },
    }),
    error: /categories\[0\] must be a string/u,
  },
  {
    name: "rejects a category longer than 20 characters",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [
          {
            name: "Temperature",
            data: [{ label: "Mon", value: 5 }],
          },
        ],
        axis_config: { categories: ["x".repeat(21)] },
      },
    }),
    error: /categories\[0\] must be at most 20 characters/u,
  },
  {
    name: "rejects duplicate categories",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [
          {
            name: "Temperature",
            data: [
              { label: "Mon", value: 5 },
              { label: "Mon", value: 6 },
            ],
          },
        ],
        axis_config: { categories: ["Mon", "Mon"] },
      },
    }),
    error: /axis_config\.categories must be unique/u,
  },
  {
    name: "rejects an x-axis label longer than 50 characters",
    props: () => ({
      ...seriesProps(),
      chart: {
        ...seriesProps().chart,
        axis_config: { categories: ["Mon"], x_label: "x".repeat(51) },
      },
    }),
    error: /axis_config\.x_label must be at most 50 characters/u,
  },
  {
    name: "rejects a non-string y-axis label",
    props: () => ({
      ...seriesProps(),
      chart: {
        ...seriesProps().chart,
        axis_config: { categories: ["Mon"], y_label: 72 },
      },
    }),
    error: /axis_config\.y_label must be a string/u,
  },
  {
    name: "rejects a non-string data point label",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: 1, value: 5 }] }],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /data\[0\]\.label must be a string/u,
  },
  {
    name: "rejects a data point label longer than 20 characters",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [
          {
            name: "Temperature",
            data: [{ label: "x".repeat(21), value: 5 }],
          },
        ],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /data\[0\]\.label must be at most 20 characters/u,
  },
  {
    name: "rejects a non-numeric data point value",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [
          { name: "Temperature", data: [{ label: "Mon", value: "five" }] },
        ],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /data\[0\]\.value must be a finite number/u,
  },
  {
    name: "rejects a data point label absent from the categories",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: "Tue", value: 5 }] }],
        axis_config: { categories: ["Mon"] },
      },
    }),
    error: /data labels must match axis_config\.categories exactly/u,
  },
  {
    name: "rejects a series that omits a category",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [{ name: "Temperature", data: [{ label: "Mon", value: 5 }] }],
        axis_config: { categories: ["Mon", "Tue"] },
      },
    }),
    error: /data labels must match axis_config\.categories exactly/u,
  },
  {
    name: "rejects duplicate data point labels",
    props: () => ({
      title: "Weather",
      chart: {
        type: "line",
        series: [
          {
            name: "Temperature",
            data: [
              { label: "Mon", value: 5 },
              { label: "Mon", value: 6 },
            ],
          },
        ],
        axis_config: { categories: ["Mon", "Tue"] },
      },
    }),
    error: /data labels must match axis_config\.categories exactly/u,
  },
];

test.each(validationCases)("$name", ({ props, error }) => {
  const node = createNativeNode(
    "slack",
    "block",
    "data_visualization",
    props(),
  );

  expect(() => serializeSlackNativeNode(node)).toThrow(error);
});

test("Slack data visualization permits negative series values", () => {
  const props = seriesProps();
  props.chart.series[0]!.data[0]!.value = -4;
  const node = createNativeNode("slack", "block", "data_visualization", props);

  expect(serializeSlackNativeNode(node)).toMatchObject({ chart: props.chart });
});

function pieProps(): Record<string, unknown> {
  return {
    title: "Weather",
    chart: { type: "pie", segments: [{ label: "Sunny", value: 5 }] },
  };
}

function seriesProps(): {
  title: string;
  chart: {
    type: string;
    series: { name: string; data: { label: string; value: number }[] }[];
    axis_config: { categories: string[] };
  };
} {
  return {
    title: "Weather",
    chart: {
      type: "line",
      series: [{ name: "Temperature", data: [{ label: "Mon", value: 5 }] }],
      axis_config: { categories: ["Mon"] },
    },
  };
}
