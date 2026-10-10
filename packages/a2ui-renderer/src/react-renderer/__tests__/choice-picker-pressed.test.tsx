import React, { useEffect } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";

/**
 * Choice chips show their selected state only through color, so each chip
 * must also expose it to assistive tech with aria-pressed.
 */

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
          component: "ChoicePicker",
          variant: "multipleSelection",
          displayStyle: "chips",
          options: [
            { label: "Red", value: "red" },
            { label: "Blue", value: "blue" },
          ],
          value: { path: "/tags" },
        },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: { surfaceId: "surface", path: "/", value: { tags: [] } },
  },
];

function Surface() {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(operations as any);
  }, [processMessages]);
  return <A2UIRenderer surfaceId="surface" />;
}

describe("A2UI React ChoicePicker chips", () => {
  afterEach(() => {
    cleanup();
  });

  it("expose their selected state with aria-pressed", async () => {
    const view = render(
      <A2UIProvider>
        <Surface />
      </A2UIProvider>,
    );
    const red = (await view.findByText("Red")).closest("button")!;
    const blue = (await view.findByText("Blue")).closest("button")!;
    expect(red.getAttribute("aria-pressed")).toBe("false");
    expect(blue.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(red);

    expect(
      (await view.findByText("Red"))
        .closest("button")!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      view.getByText("Blue").closest("button")!.getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
