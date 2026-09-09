import { expect, test } from "vitest";
import { createNativeNode } from "@copilotkit/channels-ui";
import { serializeSlackNativeNode } from "./native-codec.js";
import {
  SLACK_BLOCK_MANIFEST,
  SLACK_ELEMENT_MANIFEST,
  SLACK_NATIVE_MANIFEST,
  SLACK_OBJECT_MANIFEST,
  SLACK_UNTYPED_OBJECTS,
} from "./native-manifest.js";
import { Slack } from "./native.js";

test("Slack exposes all 19 message-valid blocks from its manifest", () => {
  expect(SLACK_BLOCK_MANIFEST).toHaveLength(19);
  expect(Object.keys(Slack.Block).sort()).toEqual(
    SLACK_BLOCK_MANIFEST.map(([name]) => name).sort(),
  );
  expect(Object.keys(Slack.Element).sort()).toEqual(
    SLACK_ELEMENT_MANIFEST.map(([name]) => name).sort(),
  );
  expect(Object.keys(Slack.Object).sort()).toEqual(
    SLACK_OBJECT_MANIFEST.map(([name]) => name).sort(),
  );
});

test("every Slack catalog entry serializes its fixed discriminator", () => {
  for (const entry of SLACK_NATIVE_MANIFEST) {
    const node = createNativeNode(
      "slack",
      entry.kind,
      entry.type,
      requiredProps(entry.type),
    );
    const serialized = serializeSlackNativeNode(node);

    // Composition objects Slack defines as plain structures must not carry a
    // discriminator: an option is `{text, value}`, and a stray `type` on it is
    // an unknown field that makes Slack refuse the whole message.
    if (entry.kind === "object" && SLACK_UNTYPED_OBJECTS.has(entry.type)) {
      expect(serialized).not.toHaveProperty("type");
    } else {
      expect(serialized.type).toBe(entry.type);
    }
    expect(entry.source).toMatch(/^https:\/\/docs\.slack\.dev\//);
  }
});

test("Slack carousel serializes cards from its elements field", () => {
  const title = createNativeNode("slack", "object", "plain_text", {
    text: "First card",
  });
  const card = createNativeNode("slack", "block", "card", { title });
  const carousel = createNativeNode("slack", "block", "carousel", {
    elements: [card],
  });

  const serialized = serializeSlackNativeNode(carousel);

  expect(serialized).toEqual({
    type: "carousel",
    elements: [
      {
        type: "card",
        title: { type: "plain_text", text: "First card" },
      },
    ],
  });
});

function requiredProps(type: string): Record<string, unknown> {
  if (type === "actions" || type === "context") return { elements: [] };
  if (type === "button" || type === "header") return { text: "text" };
  if (type === "data_visualization") {
    return {
      title: "Weather",
      chart: {
        type: "pie",
        segments: [{ label: "Sunny", value: 1 }],
      },
    };
  }
  if (type === "image")
    return { image_url: "https://example.com/image.png", alt_text: "image" };
  if (type === "input") return { label: "label", element: {} };
  if (type === "option") return { text: "option", value: "value" };
  if (type === "section") return { text: "text" };
  if (type === "video") {
    return {
      alt_text: "video",
      thumbnail_url: "https://example.com/thumbnail.png",
      title: "title",
      title_url: "https://example.com/title",
      video_url: "https://example.com/video",
    };
  }
  return {};
}

test("an image accepts either an external URL or a Slack-hosted file", () => {
  const external = createNativeNode("slack", "block", "image", {
    image_url: "https://picsum.photos/400/300",
    alt_text: "Latency chart",
  });
  const hosted = createNativeNode("slack", "block", "image", {
    slack_file: createNativeNode("slack", "object", "slack_file", {
      url: "https://files.slack.com/files-pri/T0/chart.png",
    }),
    alt_text: "Latency chart",
  });

  expect(serializeSlackNativeNode(external).image_url).toBe(
    "https://picsum.photos/400/300",
  );
  expect(serializeSlackNativeNode(hosted).slack_file).toEqual({
    url: "https://files.slack.com/files-pri/T0/chart.png",
  });

  // Neither source is still an error — the check moved, it did not disappear.
  const neither = createNativeNode("slack", "block", "image", {
    alt_text: "Latency chart",
  });
  expect(() => serializeSlackNativeNode(neither)).toThrow(
    /requires image_url or slack_file/,
  );
});
