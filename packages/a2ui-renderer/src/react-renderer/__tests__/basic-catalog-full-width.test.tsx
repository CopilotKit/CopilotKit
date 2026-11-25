import React, { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const operations = [
  {
    version: "v0.9",
    createSurface: { surfaceId: "surface", catalogId: BASIC_CATALOG_ID },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "surface",
      components: [
        {
          id: "root",
          component: "Column",
          children: ["name", "amount", "card", "rule"],
        },
        {
          id: "name",
          component: "TextField",
          label: "Name",
          value: { path: "/name" },
        },
        {
          id: "amount",
          component: "Slider",
          label: "Amount",
          min: 0,
          max: 10,
          value: { path: "/amount" },
        },
        { id: "card", component: "Card", child: "cardText" },
        { id: "cardText", component: "Text", text: "In a card" },
        { id: "rule", component: "Divider" },
      ],
    },
  },
];

function Surface() {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(operations as any);
  }, [processMessages]);
  return <A2UIRenderer surfaceId="surface" />;
}

const FULL_WIDTH = /(?:^|;\s*)width: calc\(100% - (2 \* 8px|16px)\)/;
const OVERFLOWING_WIDTH = /(?:^|;\s*)width: 100%/;

describe("basic catalog full-width components", () => {
  afterEach(() => {
    cleanup();
  });

  it("leaves room for the margin when a component fills its container", async () => {
    const { container } = render(
      <A2UIProvider>
        <Surface />
      </A2UIProvider>,
    );
    await screen.findByText("Name");

    const withMargin = Array.from(
      container.querySelectorAll("[style*='margin: 8px']"),
    ).map((element) => element.getAttribute("style") ?? "");

    expect(withMargin.filter((style) => FULL_WIDTH.test(style))).toHaveLength(
      4,
    );
    expect(withMargin.filter((style) => OVERFLOWING_WIDTH.test(style))).toEqual(
      [],
    );
  });
});
