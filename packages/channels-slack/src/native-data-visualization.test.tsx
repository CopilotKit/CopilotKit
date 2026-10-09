/** @jsxImportSource @copilotkit/channels-ui */
import { expect, test, vi } from "vitest";
import { isNativeNode, renderToIR } from "@copilotkit/channels-ui";
import { defineChannelComponent } from "@copilotkit/channels-core";
import { z } from "zod";
import { SlackAdapter } from "./adapter.js";
import { serializeSlackNativeNode } from "./native-codec.js";
import { Slack } from "./native.js";
import { renderBlockKit } from "./render/block-kit.js";

test("Slack data visualization requires a title", () => {
  const [node] = renderToIR(<Slack.Block.DataVisualization />);

  expect(isNativeNode(node)).toBe(true);
  if (!isNativeNode(node)) throw new TypeError("expected native Slack node");
  expect(() => serializeSlackNativeNode(node)).toThrow(
    /Slack\.DataVisualization\.title is required/u,
  );
});

test("Slack data visualization requires a chart", () => {
  const [node] = renderToIR(
    <Slack.Block.DataVisualization title="Weekly weather" />,
  );

  expect(isNativeNode(node)).toBe(true);
  if (!isNativeNode(node)) throw new TypeError("expected native Slack node");
  expect(() => serializeSlackNativeNode(node)).toThrow(
    /Slack\.DataVisualization\.chart is required/u,
  );
});

test("Slack permits two data visualization blocks per message", () => {
  const ir = renderToIR(
    Array.from({ length: 2 }, (_, index) => (
      <Slack.Block.DataVisualization
        key={`chart-${index}`}
        title={`Weather ${index + 1}`}
        chart={{
          type: "pie",
          segments: [{ label: "Sunny", value: 1 }],
        }}
      />
    )),
  );

  expect(renderBlockKit(ir)).toHaveLength(2);
});

test("Slack rejects more than two data visualization blocks per message", () => {
  const ir = renderToIR(
    Array.from({ length: 3 }, (_, index) => (
      <Slack.Block.DataVisualization
        key={`chart-${index}`}
        title={`Weather ${index + 1}`}
        chart={{
          type: "pie",
          segments: [{ label: "Sunny", value: 1 }],
        }}
      />
    )),
  );

  expect(() => renderBlockKit(ir)).toThrow(
    /rendered 3 data visualization blocks; the message limit is 2/u,
  );
});

test("a weather channel component reaches Slack as a data visualization block", async () => {
  const WeatherCard = defineChannelComponent({
    name: "show_weather",
    description: "Show a three-day weather forecast.",
    parameters: z.object({
      city: z.string(),
      temperatures: z.tuple([z.number(), z.number(), z.number()]),
    }),
    render: ({ city, temperatures }) => (
      <Slack.Block.DataVisualization
        title={`${city} forecast`}
        chart={{
          type: "line",
          series: [
            {
              name: "Temperature",
              data: [
                { label: "Mon", value: temperatures[0] },
                { label: "Tue", value: temperatures[1] },
                { label: "Wed", value: temperatures[2] },
              ],
            },
          ],
          axis_config: {
            categories: ["Mon", "Tue", "Wed"],
            x_label: "Day",
            y_label: "Temperature (F)",
          },
        }}
      />
    ),
  });
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  const postMessage = vi
    .spyOn(adapter.client.chat, "postMessage")
    .mockResolvedValue({ ok: true, channel: "C1", ts: "200.5" });
  const rendered = await WeatherCard.render(
    { city: "San Francisco", temperatures: [62, 65, 61] },
    { platform: "slack", signal: new AbortController().signal },
  );

  await adapter.post(
    { channel: "C1", threadTs: "100.0" },
    renderToIR(rendered),
  );

  expect(postMessage).toHaveBeenCalledWith({
    channel: "C1",
    thread_ts: "100.0",
    unfurl_links: false,
    unfurl_media: false,
    text: "San Francisco forecast",
    blocks: [
      {
        type: "data_visualization",
        title: "San Francisco forecast",
        chart: {
          type: "line",
          series: [
            {
              name: "Temperature",
              data: [
                { label: "Mon", value: 62 },
                { label: "Tue", value: 65 },
                { label: "Wed", value: 61 },
              ],
            },
          ],
          axis_config: {
            categories: ["Mon", "Tue", "Wed"],
            x_label: "Day",
            y_label: "Temperature (F)",
          },
        },
      },
    ],
  });
});
