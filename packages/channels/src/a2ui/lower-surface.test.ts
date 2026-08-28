import { describe, expect, it, vi } from "vitest";
import { CommonSchemas, MessageProcessor } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import type { ChannelNode } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-core";
import { createChannelA2UICatalog } from "./catalog.js";
import {
  A2UIUnsupportedComponentError,
  lowerSurface,
} from "./lower-surface.js";

const find = (nodes: ChannelNode[], type: string): ChannelNode | undefined => {
  for (const node of nodes) {
    if (node.type === type) return node;
    const children = node.props.children;
    if (Array.isArray(children)) {
      const nested = find(children as ChannelNode[], type);
      if (nested) return nested;
    }
  }
  return undefined;
};

describe("lowerSurface", () => {
  it("lowers bound basic and custom components without React", () => {
    const catalog = createChannelA2UICatalog(
      {
        ServiceStatus: {
          props: z
            .object({
              service: z.string(),
              status: CommonSchemas.DynamicString,
            })
            .strict(),
        },
      },
      {
        ServiceStatus: ({ props }) =>
          Section({ children: `${props.service}: ${props.status}` }),
      },
      { includeChannelBasicCatalog: true },
    );
    const processor = new MessageProcessor([catalog.processorCatalog]);
    processor.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: catalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            {
              id: "root",
              component: "Column",
              children: ["title", "service", "retry"],
            },
            {
              id: "title",
              component: "Text",
              text: { path: "/title" },
              variant: "h2",
            },
            {
              id: "service",
              component: "ServiceStatus",
              service: "api",
              status: { path: "/status" },
            },
            { id: "retry-label", component: "Text", text: "Retry" },
            {
              id: "retry",
              component: "Button",
              child: "retry-label",
              variant: "primary",
              action: {
                event: { name: "retry", context: { service: "api" } },
              },
            },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "s1",
          path: "/",
          value: { title: "Deployments", status: "failed" },
        },
      },
    ]);
    const surface = processor.model.getSurface("s1")!;

    const ir = lowerSurface(surface);

    expect(JSON.stringify(ir)).toContain("Deployments");
    expect(JSON.stringify(ir)).toContain("api: failed");
    expect(find(ir, "button")?.key).toBe("s1:retry:retry");
  });

  it("dispatches a Button action through the surface", () => {
    const action = vi.fn();
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        includeChannelBasicCatalog: true,
      },
    );
    const processor = new MessageProcessor([catalog.processorCatalog], action);
    processor.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: catalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Column", children: ["button"] },
            { id: "label", component: "Text", text: "Retry" },
            {
              id: "button",
              component: "Button",
              child: "label",
              action: { event: { name: "retry" } },
            },
          ],
        },
      },
    ]);
    const button = find(
      lowerSurface(processor.model.getSurface("s1")!),
      "button",
    )!;

    (button.props.onClick as () => void)();

    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "retry",
        surfaceId: "s1",
        sourceComponentId: "button",
      }),
    );
  });

  it("lowers Image, horizontal Divider, Card, and a button-only Row", () => {
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        includeChannelBasicCatalog: true,
      },
    );
    const processor = new MessageProcessor([catalog.processorCatalog]);
    processor.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: catalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            {
              id: "root",
              component: "Column",
              children: ["image", "divider", "card", "row"],
            },
            {
              id: "image",
              component: "Image",
              url: "https://example.com/status.png",
              description: "Status",
            },
            { id: "divider", component: "Divider", axis: "horizontal" },
            { id: "card", component: "Card", child: "card-text" },
            { id: "card-text", component: "Text", text: "Card body" },
            { id: "row", component: "Row", children: ["one", "two"] },
            { id: "one-label", component: "Text", text: "One" },
            { id: "two-label", component: "Text", text: "Two" },
            {
              id: "one",
              component: "Button",
              child: "one-label",
              action: { event: { name: "one" } },
            },
            {
              id: "two",
              component: "Button",
              child: "two-label",
              action: { event: { name: "two" } },
            },
          ],
        },
      },
    ]);

    const ir = lowerSurface(processor.model.getSurface("s1")!);

    expect(find(ir, "image")?.props).toMatchObject({
      url: "https://example.com/status.png",
      alt: "Status",
    });
    expect(find(ir, "divider")).toBeDefined();
    expect(JSON.stringify(ir)).toContain("Card body");
    const actions = find(ir, "actions")!;
    expect(
      (actions.props.children as ChannelNode[]).map((node) => node.type),
    ).toEqual(["button", "button"]);
  });

  it("rejects a vertical Divider", () => {
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        includeChannelBasicCatalog: true,
      },
    );
    const processor = new MessageProcessor([catalog.processorCatalog]);
    processor.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: catalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            {
              id: "root",
              component: "Divider",
              axis: "vertical",
            },
          ],
        },
      },
    ]);

    expect(() => lowerSurface(processor.model.getSurface("s1")!)).toThrow(
      'Unsupported A2UI component "Divider(axis=vertical)"',
    );
  });

  it("names unsupported components instead of partially rendering", () => {
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        includeChannelBasicCatalog: true,
      },
    );
    const processor = new MessageProcessor([catalog.processorCatalog]);
    processor.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: catalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "root", component: "Tabs", tabItems: [] }],
        },
      },
    ]);

    expect(() => lowerSurface(processor.model.getSurface("s1")!)).toThrow(
      new A2UIUnsupportedComponentError("Tabs"),
    );
  });
});
