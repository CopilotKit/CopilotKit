import { describe, expect, it } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import {
  PLAYGROUND_EXAMPLES,
  marketSnapshotPlaygroundInput,
} from "./examples.js";
import { compileA2UIToSlackPreview } from "./pipeline.js";

function findNodes(nodes: ChannelNode[], type: string): ChannelNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === type ? [node] : []),
    ...(Array.isArray(node.props.children)
      ? findNodes(node.props.children as ChannelNode[], type)
      : []),
  ]);
}

function blockTypes(result: ReturnType<typeof compileA2UIToSlackPreview>) {
  return result.blocks.map((block) => block.type);
}

function slackActionIds(result: ReturnType<typeof compileA2UIToSlackPreview>) {
  return result.blocks.flatMap((block) =>
    "elements" in block && Array.isArray(block.elements)
      ? block.elements.flatMap((element) =>
          "action_id" in element && typeof element.action_id === "string"
            ? [element.action_id]
            : [],
        )
      : [],
  );
}

describe("compileA2UIToSlackPreview", () => {
  it("compiles the market snapshot fixture through IR into Slack blocks", () => {
    const result = compileA2UIToSlackPreview(marketSnapshotPlaygroundInput);

    expect(result.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(blockTypes(result)).toEqual([
      "header",
      "section",
      "table",
      "divider",
      "section",
      "context",
      "actions",
    ]);
    expect(JSON.stringify(result.blocks)).toContain(
      "Live energy market snapshot",
    );
    expect(JSON.stringify(result.blocks)).toContain("Reuters");
    expect(Object.keys(result.actions)).toEqual([
      "a2ui|s1|root|acknowledge_search_result",
    ]);
    expect(slackActionIds(result)).toEqual(Object.keys(result.actions));
  });

  it("dispatches a preview button through the A2UI processor and returns the resolved client action", async () => {
    const result = compileA2UIToSlackPreview({
      surfaceId: "status",
      components: [
        { id: "root", component: "Column", children: ["button"] },
        { id: "label", component: "Text", text: "Retry" },
        {
          id: "button",
          component: "Button",
          child: "label",
          action: {
            event: {
              name: "retry",
              context: { service: { path: "/service" } },
            },
          },
        },
      ],
      data: { service: "api" },
    });

    const actionId = Object.keys(result.actions)[0]!;
    const action = await result.actions[actionId]!();

    expect(actionId).toBe("a2ui|status|button|retry");
    expect(action).toMatchObject({
      name: "retry",
      surfaceId: "status",
      sourceComponentId: "button",
      context: { service: "api" },
    });
  });

  it("returns diagnostics instead of throwing for invalid shapes, duplicate ids, missing roots, and cycles", () => {
    const invalid = compileA2UIToSlackPreview({ components: [] });
    const duplicate = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [
        { id: "root", component: "Text", text: "One" },
        { id: "root", component: "Text", text: "Two" },
      ],
    });
    const missingRoot = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [{ id: "body", component: "Text", text: "Body" }],
    });
    const missingId = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [{ component: "Text", text: "Body" }],
    });
    const cycle = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [
        { id: "root", component: "Column", children: ["child"] },
        { id: "child", component: "Column", children: ["root"] },
      ],
    });

    expect(invalid.diagnostics.map((d) => d.code)).toContain("INVALID_INPUT");
    expect(duplicate.diagnostics.map((d) => d.code)).toContain("DUPLICATE_ID");
    expect(missingRoot.diagnostics.map((d) => d.code)).toContain(
      "MISSING_ROOT",
    );
    expect(missingId.diagnostics.map((d) => d.code)).toContain("INVALID_INPUT");
    expect(cycle.diagnostics.map((d) => d.code)).toContain("CYCLIC_REFERENCE");
    expect(cycle.blocks).toEqual([]);
  });

  it("validates component props against the catalog schema before rendering", () => {
    const badText = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [{ id: "root", component: "Text" }],
    });
    const badMarket = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [
        {
          id: "root",
          component: "MarketSnapshot",
          headline: "Incomplete",
        },
      ],
    });

    expect(badText.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_COMPONENT_PROPS",
        path: "components.0",
      }),
    );
    expect(badMarket.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_COMPONENT_PROPS",
        path: "components.0",
      }),
    );
    expect(badMarket.blocks).toEqual([]);
  });

  it("reports unsupported components without uncaught render errors", () => {
    const unknown = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [{ id: "root", component: "InventedCard" }],
    });
    const verticalDivider = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [{ id: "root", component: "Divider", axis: "vertical" }],
    });

    expect(unknown.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_COMPONENT",
        message: expect.stringContaining("InventedCard"),
      }),
    );
    expect(verticalDivider.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_COMPONENT",
        message: expect.stringContaining("Divider(axis=vertical)"),
      }),
    );
  });

  it("emits simplification warnings for lossy layout and text lowering", () => {
    const result = compileA2UIToSlackPreview({
      surfaceId: "s1",
      components: [
        { id: "root", component: "Row", children: ["left", "right"] },
        { id: "left", component: "Text", text: "Left", variant: "caption" },
        { id: "right", component: "Text", text: "Right", variant: "body" },
      ],
    });

    expect(findNodes(result.ir, "context")).toHaveLength(1);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LAYOUT_SIMPLIFIED" }),
        expect.objectContaining({ code: "TEXT_VARIANT_SIMPLIFIED" }),
      ]),
    );
  });

  it("keeps same-name actions distinct by source component and resolved context", async () => {
    const result = compileA2UIToSlackPreview({
      surfaceId: "same-event",
      components: [
        { id: "root", component: "Row", children: ["one", "two"] },
        { id: "one-label", component: "Text", text: "One" },
        { id: "two-label", component: "Text", text: "Two" },
        {
          id: "one",
          component: "Button",
          child: "one-label",
          action: {
            event: { name: "choose", context: { value: { path: "/one" } } },
          },
        },
        {
          id: "two",
          component: "Button",
          child: "two-label",
          action: {
            event: { name: "choose", context: { value: { path: "/two" } } },
          },
        },
      ],
      data: { one: "alpha", two: "bravo" },
    });

    const actionIds = Object.keys(result.actions);
    const first = await result.actions["a2ui|same-event|one|choose"]!();
    const second = await result.actions["a2ui|same-event|two|choose"]!();

    expect(actionIds).toEqual([
      "a2ui|same-event|one|choose",
      "a2ui|same-event|two|choose",
    ]);
    expect(slackActionIds(result)).toEqual(actionIds);
    expect(first).toMatchObject({
      name: "choose",
      sourceComponentId: "one",
      context: { value: "alpha" },
    });
    expect(second).toMatchObject({
      name: "choose",
      sourceComponentId: "two",
      context: { value: "bravo" },
    });
  });

  it("keeps rapid distinct action dispatches isolated", async () => {
    const result = compileA2UIToSlackPreview({
      surfaceId: "rapid",
      components: [
        { id: "root", component: "Row", children: ["one", "two"] },
        { id: "one-label", component: "Text", text: "One" },
        { id: "two-label", component: "Text", text: "Two" },
        {
          id: "one",
          component: "Button",
          child: "one-label",
          action: {
            event: { name: "choose", context: { value: { path: "/one" } } },
          },
        },
        {
          id: "two",
          component: "Button",
          child: "two-label",
          action: {
            event: { name: "choose", context: { value: { path: "/two" } } },
          },
        },
      ],
      data: { one: "alpha", two: "bravo" },
    });

    const [first, second] = await Promise.all([
      result.actions["a2ui|rapid|one|choose"]!(),
      result.actions["a2ui|rapid|two|choose"]!(),
    ]);

    expect(first).toMatchObject({
      sourceComponentId: "one",
      context: { value: "alpha" },
    });
    expect(second).toMatchObject({
      sourceComponentId: "two",
      context: { value: "bravo" },
    });
  });

  it("keeps escaped component-id collisions distinct and concurrent", async () => {
    const result = compileA2UIToSlackPreview({
      surfaceId: "escape",
      components: [
        { id: "root", component: "Row", children: ["a b", "a_b"] },
        { id: "space-label", component: "Text", text: "Space" },
        { id: "underscore-label", component: "Text", text: "Underscore" },
        {
          id: "a b",
          component: "Button",
          child: "space-label",
          action: {
            event: { name: "choose", context: { value: { path: "/space" } } },
          },
        },
        {
          id: "a_b",
          component: "Button",
          child: "underscore-label",
          action: {
            event: {
              name: "choose",
              context: { value: { path: "/underscore" } },
            },
          },
        },
      ],
      data: { space: "space", underscore: "underscore" },
    });

    const actionIds = Object.keys(result.actions);
    const [space, underscore] = await Promise.all([
      result.actions["a2ui|escape|a%20b|choose"]!(),
      result.actions["a2ui|escape|a_b|choose"]!(),
    ]);

    expect(actionIds).toEqual([
      "a2ui|escape|a%20b|choose",
      "a2ui|escape|a_b|choose",
    ]);
    expect(slackActionIds(result)).toEqual(actionIds);
    expect(space).toMatchObject({
      sourceComponentId: "a b",
      context: { value: "space" },
    });
    expect(underscore).toMatchObject({
      sourceComponentId: "a_b",
      context: { value: "underscore" },
    });
  });

  it("exports playground examples with the market snapshot first", () => {
    expect(PLAYGROUND_EXAMPLES[0]).toMatchObject({
      id: "market-snapshot",
      label: "Market snapshot",
      input: marketSnapshotPlaygroundInput,
    });
    expect(PLAYGROUND_EXAMPLES.map((example) => example.id)).toEqual([
      "market-snapshot",
      "basic-text-button",
      "unsupported-component",
    ]);
  });
});
