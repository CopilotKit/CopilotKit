import React, { useEffect } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
} from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";

const versions = [
  ["v0.9", "https://a2ui.org/specification/v0_9/basic_catalog.json"],
  ["1.0", "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"],
] as const;

type WireComponent = { id: string; component: string; [key: string]: unknown };
/**
 * Initialize a surface with the supplied protocol and catalog, exposing provider
 * actions and captured user actions so every protocol case uses the same harness.
 */
function mount(
  version: string,
  catalogId: string,
  components: WireComponent[],
  data = {},
  onAction = vi.fn(),
) {
  let actions!: ReturnType<typeof useA2UIActions>;
  function Surface() {
    actions = useA2UIActions();
    const error = useA2UIError();
    useEffect(() => {
      actions.processMessages([
        { version, createSurface: { surfaceId: "s", catalogId } },
        { version, updateComponents: { surfaceId: "s", components } },
        { version, updateDataModel: { surfaceId: "s", value: data } },
      ]);
    }, []);
    return (
      <>
        {error && <div role="alert">{error}</div>}
        <A2UIRenderer surfaceId="s" />
      </>
    );
  }
  const view = render(
    <A2UIProvider onAction={onAction}>
      <Surface />
    </A2UIProvider>,
  );
  return { ...view, actions, onAction };
}

const samples: [string, Record<string, unknown>, string][] = [
  ["Text", { text: "Visible text" }, "span"],
  [
    "Image",
    { url: "https://example.com/image.png", description: "Picture" },
    "img",
  ],
  ["Icon", { name: "add" }, ".material-symbols-outlined"],
  ["Video", { url: "https://example.com/movie.mp4" }, "video"],
  ["AudioPlayer", { url: "https://example.com/audio.mp3" }, "audio"],
  ["Row", { children: ["label"] }, "span"],
  ["Column", { children: ["label"] }, "span"],
  ["List", { children: ["label"] }, "span"],
  ["Card", { child: "label" }, "span"],
  ["Tabs", { tabs: [{ title: "Tab", child: "label" }] }, "button"],
  ["Divider", {}, "div"],
  ["Modal", { trigger: "label", content: "detail" }, "span"],
  [
    "Button",
    { child: "label", action: { event: { name: "submit" } } },
    "button",
  ],
  ["TextField", { label: "Name", value: "Ada" }, "input"],
  ["CheckBox", { label: "Agree", value: true }, "input[type=checkbox]"],
  [
    "ChoicePicker",
    {
      options: [{ label: "First", value: "first" }],
      value: ["first"],
      variant: "mutuallyExclusive",
    },
    "input[type=radio]",
  ],
  [
    "Slider",
    { label: "Amount", min: 0, max: 10, value: 5 },
    "input[type=range]",
  ],
  [
    "DateTimeInput",
    { label: "Date", value: "2026-11-11", enableDate: true, enableTime: false },
    "input[type=date]",
  ],
];

describe.each(versions)("native %s React catalog", (version, catalogId) => {
  it.each(samples)("renders %s", (component, props, selector) => {
    const components: WireComponent[] = [{ id: "root", component, ...props }];
    if (JSON.stringify(props).includes('"label"'))
      components.push({ id: "label", component: "Text", text: "Child" });
    if (component === "Modal")
      components.push({
        id: "detail",
        component: "Text",
        text: "Dialog content",
      });
    const view = mount(version, catalogId, components);
    expect(view.queryByRole("alert")).toBeNull();
    expect(
      view.container.querySelector(`[data-surface-id=s] ${selector}`),
    ).not.toBeNull();
    if (component === "Modal") {
      fireEvent.click(view.getByText("Child"));
      expect(view.getByText("Dialog content")).toBeTruthy();
    }
  });

  it("resolves list-relative bindings, two-way fields and event context", async () => {
    const binding = (path: string) =>
      version === "1.0" ? { "@path": path } : { path };
    const components = [
      {
        id: "root",
        component: "Column",
        children: ["field", "list", "submit"],
      },
      {
        id: "field",
        component: "TextField",
        label: "Name",
        value: binding("/name"),
      },
      {
        id: "list",
        component: "List",
        children: { componentId: "item", path: "/items" },
      },
      { id: "item", component: "Text", text: binding("name") },
      {
        id: "submit",
        component: "Button",
        child: "label",
        action: {
          event: { name: "submit", context: { name: binding("/name") } },
        },
      },
      { id: "label", component: "Text", text: "Save" },
    ];
    const view = mount(version, catalogId, components, {
      name: "Ada",
      items: [{ name: "Bolt A" }, { name: "Bolt B" }],
    });
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Bolt A")).toBeTruthy();
    expect(view.getByText("Bolt B")).toBeTruthy();
    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Grace" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(view.onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userAction: expect.objectContaining({
            name: "submit",
            context: { name: "Grace" },
            surfaceId: "s",
          }),
        }),
      ),
    );
    act(() => view.actions.clearSurfaces());
    expect(view.container.querySelector("[data-surface-id=s]")).toBeNull();
  });

  it("evaluates native function calls", () => {
    const call =
      version === "1.0"
        ? { "@call": "formatNumber" }
        : { call: "formatNumber" };
    const view = mount(version, catalogId, [
      {
        id: "root",
        component: "Text",
        text: { ...call, args: { value: 1234, decimals: 0 } },
      },
    ]);
    expect(view.getByText("1,234")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
  });
});

describe("surface protocol lifetime", () => {
  it("keeps both protocols in one provider and clears each with its own version", () => {
    const view = mount(...versions[0], [
      { id: "root", component: "Text", text: "Legacy" },
    ]);
    act(() =>
      view.actions.processMessages([
        {
          version: "1.0",
          createSurface: {
            surfaceId: "new",
            catalogId: versions[1][1],
            components: [{ id: "root", component: "Text", text: "Modern" }],
          },
        },
      ]),
    );
    expect(view.actions.getSurface("s").protocolVersion).toMatch(/0\.9/);
    expect(
      view.actions.getSurface("new").componentsModel.get("root")?.properties
        .text,
    ).toBe("Modern");
    act(() => view.actions.clearSurfaces());
    expect(view.actions.getSurface("s")).toBeUndefined();
    expect(view.actions.getSurface("new")).toBeUndefined();
  });

  it("rejects a version-changing data update without modifying the surface", () => {
    const view = mount(
      ...versions[0],
      [{ id: "root", component: "Text", text: { path: "/name" } }],
      { name: "Legacy" },
    );
    act(() =>
      view.actions.processMessages([
        {
          version: "1.0",
          updateDataModel: { surfaceId: "s", value: { name: "Wrong version" } },
        },
      ]),
    );
    expect(view.getByRole("alert").textContent).toMatch(/version/i);
    expect(view.getByText("Legacy")).toBeTruthy();
    expect(view.queryByText("Wrong version")).toBeNull();
  });

  it("keeps unversioned messages on the v0.9 default", () => {
    const view = mount(
      ...versions[0],
      [{ id: "root", component: "Text", text: { path: "/name" } }],
      { name: "Before" },
    );
    act(() =>
      view.actions.processMessages([
        {
          updateDataModel: { surfaceId: "s", value: { name: "Default v0.9" } },
        },
      ]),
    );
    expect(view.getByText("Default v0.9")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
  });
});
