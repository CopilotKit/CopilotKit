import { expect, test } from "vitest";
import { createNativeNode } from "@copilotkit/channels-ui";
import { serializeSlackNativeNode } from "./native-codec.js";
import {
  SLACK_BLOCK_MANIFEST,
  SLACK_ELEMENT_MANIFEST,
  SLACK_NATIVE_MANIFEST,
  SLACK_OBJECT_MANIFEST,
} from "./native-manifest.js";
import { Slack } from "./native.js";

test("Slack exposes all 20 message-valid blocks from its manifest", () => {
  expect(SLACK_BLOCK_MANIFEST).toHaveLength(20);
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
    expect(serializeSlackNativeNode(node).type).toBe(entry.type);
    expect(entry.source).toMatch(/^https:\/\/docs\.slack\.dev\//);
  }
});

function requiredProps(type: string): Record<string, unknown> {
  if (type === "actions" || type === "context") return { elements: [] };
  if (type === "button" || type === "header") return { text: "text" };
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
