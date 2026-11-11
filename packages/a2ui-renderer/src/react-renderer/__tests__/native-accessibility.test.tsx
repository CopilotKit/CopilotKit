import React, { useEffect } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
} from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";

function mount(components: Record<string, unknown>[], version = "1.0") {
  function Surface() {
    const { processMessages } = useA2UIActions();
    const error = useA2UIError();
    useEffect(() => {
      processMessages([
        {
          version,
          createSurface: {
            surfaceId: "accessible",
            catalogId:
              version === "1.0"
                ? "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
                : "https://a2ui.org/specification/v0_9/basic_catalog.json",
          },
        },
        {
          version,
          updateComponents: { surfaceId: "accessible", components },
        },
      ]);
    }, [processMessages]);
    return (
      <>
        {error && <div role="alert">{error}</div>}
        <A2UIRenderer surfaceId="accessible" />
      </>
    );
  }
  return render(
    <A2UIProvider>
      <Surface />
    </A2UIProvider>,
  );
}

describe.each(["1.0", "v0.9"])("%s common accessibility", (version) => {
  it("renders an accessible Text component", () => {
    const view = mount(
      [
        {
          id: "root",
          component: "Text",
          text: "Visible",
          accessibility: { label: "Greeting" },
        },
      ],
      version,
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Visible")).toBeTruthy();
  });

  it("renders the children of an accessible root layout", () => {
    const view = mount(
      [
        {
          id: "root",
          component: "Column",
          children: ["text"],
          accessibility: { label: "Details" },
        },
        {
          id: "text",
          component: "Text",
          text: "Child content",
          accessibility: { label: "Description" },
        },
      ],
      version,
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Child content")).toBeTruthy();
  });

  it("still rejects invalid component-specific properties", () => {
    const view = mount(
      [
        {
          id: "root",
          component: "Text",
          text: { invalid: true },
          accessibility: { label: "Greeting" },
        },
      ],
      version,
    );
    expect(view.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(view.container.textContent).toMatch(/text|invalid/i);
  });
});
