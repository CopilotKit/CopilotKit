import { describe, expect, it } from "vitest";
import {
  findPlatformNodes,
  platformNode,
  PlatformUiMismatchError,
  UnsupportedUiNodeError,
  validatePlatformUi,
} from "./platform.js";
import type { ChannelNode, PlatformNode } from "./index.js";

function teamsNode(
  element: string,
  children: ChannelNode[] = [],
): PlatformNode {
  return platformNode({
    protocol: 1,
    platform: "teams",
    dialect: "adaptive-card",
    dialectVersion: "1.5",
    element,
    attributes: {},
    ...(children.length > 0 ? { children } : {}),
  });
}

describe("platform-native IR", () => {
  it("preserves platform nodes and their paths", () => {
    const root = [teamsNode("AdaptiveCard", [teamsNode("TextBlock")])];

    expect(findPlatformNodes(root)).toEqual([
      { node: root[0], path: [0] },
      { node: root[0]!.props.children![0], path: [0, "children", 0] },
    ]);
  });

  it("rejects a native tree before it reaches another platform", () => {
    expect(() =>
      validatePlatformUi([teamsNode("AdaptiveCard")], "slack"),
    ).toThrow(PlatformUiMismatchError);

    try {
      validatePlatformUi([teamsNode("AdaptiveCard")], "slack");
    } catch (error) {
      expect(error).toMatchObject({
        actualPlatform: "slack",
        expectedPlatform: "teams",
        element: "AdaptiveCard",
        path: [0],
      });
    }
  });

  it("rejects mixed portable and native UI", () => {
    const portable: ChannelNode = { type: "section", props: {} };
    expect(() =>
      validatePlatformUi([teamsNode("AdaptiveCard", [portable])], "teams"),
    ).toThrow(UnsupportedUiNodeError);
  });

  it("rejects trees that combine platform dialects", () => {
    const otherDialect = platformNode({
      protocol: 1,
      platform: "teams",
      dialect: "another-dialect",
      dialectVersion: "1.5",
      element: "Other",
      attributes: {},
    });

    expect(() =>
      validatePlatformUi([teamsNode("AdaptiveCard", [otherDialect])], "teams"),
    ).toThrow(/mixed dialect tree/);
  });
});
