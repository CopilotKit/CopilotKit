import React, { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
} from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";

/** Mount one protocol-selected surface and expose its stable actions for updates. */
function mount(
  components: Record<string, unknown>[],
  version = "1.0",
  data: Record<string, unknown> = {},
) {
  let actions!: ReturnType<typeof useA2UIActions>;
  function Surface() {
    actions = useA2UIActions();
    const { processMessages } = actions;
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
        {
          version,
          updateDataModel: { surfaceId: "accessible", value: data },
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
  const view = render(
    <A2UIProvider>
      <Surface />
    </A2UIProvider>,
  );
  return { ...view, actions };
}

/** Build a replacement button operation, including complete accessibility removal. */
function buttonComponent(accessibility?: Record<string, unknown>) {
  return {
    id: "root",
    component: "Button",
    child: "icon",
    action: { event: { name: "add" } },
    ...(accessibility ? { accessibility } : {}),
  };
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
    expect(view.getByText("Visible").getAttribute("aria-label")).toBe(
      "Greeting",
    );
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
    const text = view.getByText("Child content");
    expect(text.getAttribute("aria-label")).toBe("Description");
    expect(text.parentElement?.getAttribute("aria-label")).toBe("Details");
  });

  it("names an icon-only button from the specified accessibility label", () => {
    const view = mount(
      [
        {
          id: "root",
          component: "Button",
          child: "icon",
          action: { event: { name: "add" } },
          accessibility: { label: "Add item" },
        },
        { id: "icon", component: "Icon", name: "add" },
      ],
      version,
    );
    expect(view.getByRole("button", { name: "Add item" }).tagName).toBe(
      "BUTTON",
    );
  });

  it.each([
    ["TextField", { label: "Visual label", value: "Ada" }, "INPUT"],
    [
      "TextField",
      { label: "Visual label", value: "Ada", variant: "longText" },
      "TEXTAREA",
    ],
    ["CheckBox", { label: "Visual label", value: true }, "INPUT"],
    ["Slider", { label: "Visual label", value: 0.5, min: 0, max: 1 }, "INPUT"],
    [
      "DateTimeInput",
      {
        label: "Visual label",
        value: "2026-11-11",
        enableDate: true,
        enableTime: false,
      },
      "INPUT",
    ],
  ])(
    "applies the %s accessible name to its editable control",
    (component, props, tag) => {
      const view = mount(
        [
          {
            id: "root",
            component,
            ...props,
            accessibility: { label: "Accessible field" },
          },
        ],
        version,
      );
      expect(view.getByLabelText("Accessible field").tagName).toBe(tag);
      expect(view.queryByRole("alert")).toBeNull();
    },
  );

  it("updates bound accessibility and removes stale attributes without remounting", () => {
    const binding = (path: string) =>
      version === "1.0" ? { "@path": path } : { path };
    const accessibility = {
      label: binding("/label"),
      description: binding("/description"),
      // The v0.9 common schema only defines label and description.
      ...(version === "1.0"
        ? { hidden: binding("/hidden"), live: "polite" }
        : {}),
    };
    const view = mount(
      [
        buttonComponent(accessibility),
        { id: "icon", component: "Icon", name: "add" },
      ],
      version,
      { label: "Add item", description: "Adds another row", hidden: false },
    );
    const control = view.getByRole("button", {
      name: "Add item",
    });
    // This workspace's DOM accessibility API predates aria-description support.
    expect(control.getAttribute("aria-description")).toBe("Adds another row");
    expect(control.getAttribute("aria-live")).toBe(
      version === "1.0" ? "polite" : null,
    );
    expect(control.getAttribute("aria-hidden")).toBe(
      version === "1.0" ? "false" : null,
    );

    act(() =>
      view.actions.processMessages([
        {
          version,
          updateDataModel: {
            surfaceId: "accessible",
            value: {
              label: "Remove item",
              description: "Removes this row",
              hidden: true,
            },
          },
        },
      ]),
    );
    expect(control.getAttribute("aria-label")).toBe("Remove item");
    expect(control.getAttribute("aria-description")).toBe("Removes this row");
    if (version === "1.0") {
      expect(control.getAttribute("aria-hidden")).toBe("true");
      expect(view.queryByRole("button")).toBeNull();
    }

    act(() =>
      view.actions.processMessages([
        {
          version,
          updateDataModel: {
            surfaceId: "accessible",
            path: "/hidden",
            value: false,
          },
        },
        {
          version,
          updateComponents: {
            surfaceId: "accessible",
            components: [
              buttonComponent({
                ...accessibility,
                ...(version === "1.0" ? { live: "assertive" } : {}),
              }),
            ],
          },
        },
      ]),
    );
    expect(
      view.getByRole("button", {
        name: "Remove item",
      }),
    ).toBe(control);
    expect(control.getAttribute("aria-live")).toBe(
      version === "1.0" ? "assertive" : null,
    );
    expect(control.getAttribute("aria-hidden")).toBe(
      version === "1.0" ? "false" : null,
    );

    act(() =>
      view.actions.processMessages([
        {
          version,
          updateComponents: {
            surfaceId: "accessible",
            components: [buttonComponent()],
          },
        },
      ]),
    );
    expect(view.getByRole("button", { name: "add" })).toBe(control);
    for (const attribute of [
      "aria-label",
      "aria-description",
      "aria-live",
      "aria-hidden",
    ]) {
      expect(control.hasAttribute(attribute)).toBe(false);
    }
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
