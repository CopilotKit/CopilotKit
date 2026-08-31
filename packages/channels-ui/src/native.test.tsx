import { expect, test, vi } from "vitest";
import { createNativeNode, isNativeNode } from "./native.js";
import { renderToIR } from "./render.js";

function SlackButton(props: { text: string; onClick: () => void }) {
  return createNativeNode("slack", "element", "button", props);
}

function SlackSection(props: { accessory: unknown; text: string }) {
  return createNativeNode("slack", "block", "section", props);
}

test("native JSX keeps provider identity and traverses named slots", () => {
  const onClick = vi.fn();

  const [section] = renderToIR(
    <SlackSection
      text="Order 42"
      accessory={
        <SlackButton key="approve-order" text="Approve" onClick={onClick} />
      }
    />,
  );

  expect(section).toBeDefined();
  if (!section) throw new Error("expected one rendered Slack section");
  expect(isNativeNode(section)).toBe(true);
  expect(section).toMatchObject({
    props: {
      provider: "slack",
      nativeKind: "block",
      nativeType: "section",
      text: "Order 42",
      accessory: {
        key: "approve-order",
        props: {
          provider: "slack",
          nativeKind: "element",
          nativeType: "button",
          text: "Approve",
          onClick,
        },
      },
    },
  });
});

test("native JSX traverses arrays in named slots without changing plain objects", () => {
  const [section] = renderToIR(
    createNativeNode("teams", "element", "ActionSet", {
      actions: [
        createNativeNode("teams", "action", "Action.OpenUrl", {
          title: "Open",
          url: "https://example.com",
        }),
      ],
      metadata: { webUrl: "https://example.com" },
    }),
  );

  expect(section).toBeDefined();
  if (!section) throw new Error("expected one rendered Teams action set");
  expect(section.props.actions).toEqual([
    expect.objectContaining({
      props: expect.objectContaining({
        provider: "teams",
        nativeType: "Action.OpenUrl",
      }),
    }),
  ]);
  expect(section.props.metadata).toEqual({ webUrl: "https://example.com" });
});
