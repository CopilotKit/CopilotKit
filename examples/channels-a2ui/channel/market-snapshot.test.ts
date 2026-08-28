import { renderToIR } from "@copilotkit/channels";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels";
import { describe, expect, it, vi } from "vitest";
import {
  createMarketSnapshotCatalog,
  renderMarketSnapshot,
} from "./market-snapshot.js";
import { marketSnapshotProps } from "./market-snapshot.fixture.js";

describe("MarketSnapshot example catalog", () => {
  it("advertises only the complete semantic component", () => {
    const catalog = createMarketSnapshotCatalog();
    const snapshot = catalog.schema.components.MarketSnapshot;

    expect(Object.keys(catalog.schema.components)).toEqual(["MarketSnapshot"]);
    expect(snapshot).toMatchObject({
      description: expect.stringContaining("Acknowledge action"),
    });
    expect(JSON.stringify(snapshot)).toContain("Current grounded price");
    expect(JSON.stringify(snapshot)).toContain("Exactly three related");
    expect(catalog.id).toBe("copilotkit://channels-market-snapshot/v1");
  });

  it("requires an ISO 8601 search timestamp", () => {
    const implementation =
      createMarketSnapshotCatalog().processorCatalog.components.get(
        "MarketSnapshot",
      )!;

    expect(
      implementation.schema.safeParse({
        ...marketSnapshotProps,
        searchedAt: "not-a-timestamp",
      }).success,
    ).toBe(false);
  });

  it("renders a sourced Channel UI message with table and action", () => {
    const ir = renderToIR(renderMarketSnapshot(marketSnapshotProps));
    const children = ir[0]!.props.children as ChannelNode[];

    expect(ir.map((node) => node.type)).toEqual(["message"]);
    expect(children.map((node) => node.type)).toEqual([
      "header",
      "section",
      "table",
      "divider",
      "section",
      "context",
      "actions",
    ]);
    expect(JSON.stringify(ir)).toContain("Brent crude");
    expect(JSON.stringify(ir)).toContain("Acknowledge");
    const actions = children.find((node) => node.type === "actions")!;
    expect((actions.props.children as ChannelNode[])[0]?.key).toBe(
      "acknowledge-search-result",
    );
  });

  it("owns the acknowledge event in the example lowerer", async () => {
    const catalog = createMarketSnapshotCatalog();
    const implementation =
      catalog.processorCatalog.components.get("MarketSnapshot")!;
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const rawProps = marketSnapshotProps as unknown as Record<string, unknown>;
    const ir = renderToIR(
      implementation.lower(rawProps, {
        componentId: "root",
        surfaceId: "market",
        rawProps,
        children: () => [],
        dispatch,
      }),
    );
    const actions = (ir[0]!.props.children as ChannelNode[]).find(
      (node) => node.type === "actions",
    )!;
    const button = (actions.props.children as ChannelNode[])[0]!;
    const interaction = {} as InteractionContext;

    await (button.props.onClick as (ctx: InteractionContext) => Promise<void>)(
      interaction,
    );

    expect(dispatch).toHaveBeenCalledWith(
      { event: { name: "acknowledge_search_result" } },
      interaction,
    );
  });
});
