import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createA2UIMessageRenderer } from "../a2ui/A2UIMessageRenderer";

vi.mock("../providers", () => ({
  useCopilotKit: () => ({
    copilotkit: { properties: {}, setProperties: vi.fn(), runAgent: vi.fn() },
  }),
}));

const V1_CATALOG =
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
const V09_CATALOG = "https://a2ui.org/specification/v0_9/basic_catalog.json";
type Component = { id: string; component: string; [key: string]: unknown };
/**
 * Build a canonical native snapshot with inline components, keeping an omitted
 * data model distinct from an explicitly supplied empty object.
 */
function inline(components: Component[], dataModel?: Record<string, unknown>) {
  return {
    a2ui_operations: [
      {
        version: "1.0",
        createSurface: {
          surfaceId: "native",
          catalogId: V1_CATALOG,
          components,
          ...(dataModel === undefined ? {} : { dataModel }),
        },
      },
    ],
  };
}
function renderer(onAction?: ReturnType<typeof vi.fn>) {
  return createA2UIMessageRenderer({ theme: {}, onAction })
    .render as React.FC<any>;
}
/**
 * Read the surface wrapper's reveal state so tests distinguish mounted offscreen
 * content from a completed loader-to-surface handoff.
 */
function visible(view: ReturnType<typeof render>) {
  return view.container
    .querySelector("[aria-hidden]")
    ?.getAttribute("aria-hidden");
}
const text = (value: unknown): Component[] => [
  { id: "root", component: "Text", text: value },
];

describe("A2UIMessageRenderer native 1.0 lifecycle", () => {
  it("makes an inline-only create visible without waiting for the paint fallback", async () => {
    const Render = renderer();
    const view = render(
      <Render content={inline(text("Inline content"))} agent={null} />,
    );
    expect(view.getByText("Inline content")).toBeTruthy();
    await waitFor(() => expect(visible(view)).toBe("false"));
  });

  it("replays changing inline components and data without remounting the surface", async () => {
    const Render = renderer();
    const view = render(
      <Render
        content={inline(text({ "@path": "/name" }), { name: "Ada" })}
        agent={null}
      />,
    );
    expect(view.getByText("Ada")).toBeTruthy();
    const surface = view.container.querySelector("[data-surface-id=native]");
    view.rerender(
      <Render
        content={inline(text({ "@path": "/name" }), { name: "Grace" })}
        agent={null}
      />,
    );
    await waitFor(() => expect(view.getByText("Grace")).toBeTruthy());
    expect(view.container.querySelector("[data-surface-id=native]")).toBe(
      surface,
    );
    view.rerender(
      <Render content={inline(text("New component content"))} agent={null} />,
    );
    await waitFor(() =>
      expect(view.getByText("New component content")).toBeTruthy(),
    );
    expect(view.container.querySelector("[data-surface-id=native]")).toBe(
      surface,
    );
  });

  it("honors explicit deletion before native recreation in the same snapshot", async () => {
    const Render = renderer();
    const view = render(
      <Render content={inline(text("Before deletion"))} agent={null} />,
    );
    view.rerender(
      <Render
        content={{
          a2ui_operations: [
            { version: "1.0", deleteSurface: { surfaceId: "native" } },
            ...inline(text("After recreation")).a2ui_operations,
          ],
        }}
        agent={null}
      />,
    );
    await waitFor(() =>
      expect(view.getByText("After recreation")).toBeTruthy(),
    );
    expect(view.queryByText("Before deletion")).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("distinguishes an omitted inline data model from an explicitly empty one", async () => {
    const Render = renderer();
    const components = text({ "@path": "/name" });
    const view = render(
      <Render
        content={inline(components, { name: "Preserved" })}
        agent={null}
      />,
    );
    view.rerender(<Render content={inline(components)} agent={null} />);
    expect(view.getByText("Preserved")).toBeTruthy();
    view.rerender(<Render content={inline(components, {})} agent={null} />);
    await waitFor(() => expect(view.queryByText("Preserved")).toBeNull());
  });

  it("waits for native bound values before making a progressive surface visible", async () => {
    const Render = renderer();
    const operations = [
      {
        version: "1.0",
        createSurface: { surfaceId: "native", catalogId: V1_CATALOG },
      },
      {
        version: "1.0",
        updateComponents: {
          surfaceId: "native",
          components: text({ "@path": "/name" }),
        },
      },
    ];
    const view = render(
      <Render content={{ a2ui_operations: operations }} agent={null} />,
    );
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(visible(view)).toBe("true");
    const surface = view.container.querySelector("[data-surface-id=native]");
    view.rerender(
      <Render
        content={{
          a2ui_operations: [
            ...operations,
            {
              version: "1.0",
              updateDataModel: {
                surfaceId: "native",
                value: { name: "Arrived" },
              },
            },
          ],
        }}
        agent={null}
      />,
    );
    await waitFor(() => expect(visible(view)).toBe("false"));
    expect(view.getByText("Arrived")).toBeTruthy();
    expect(view.container.querySelector("[data-surface-id=native]")).toBe(
      surface,
    );
  });

  it.each([
    {
      value: "Hello",
      path: "/headline",
      components: text({ "@path": "/headline" }),
    },
    {
      value: 0,
      path: "/amount",
      components: [
        {
          id: "root",
          component: "Slider",
          label: "Amount",
          max: 10,
          value: { "@path": "/amount" },
        },
      ],
    },
    {
      value: false,
      path: "/enabled",
      components: [
        {
          id: "root",
          component: "CheckBox",
          label: "Enabled",
          value: { "@path": "/enabled" },
        },
      ],
    },
  ])(
    "reveals a native surface after a scalar leaf update with value $value",
    async ({ value, path, components }) => {
      const Render = renderer();
      const view = render(
        <Render
          content={{
            a2ui_operations: [
              {
                version: "1.0",
                createSurface: { surfaceId: "native", catalogId: V1_CATALOG },
              },
              {
                version: "1.0",
                updateComponents: { surfaceId: "native", components },
              },
              {
                version: "1.0",
                updateDataModel: { surfaceId: "native", path, value },
              },
            ],
          }}
          agent={null}
        />,
      );
      await waitFor(() => expect(visible(view)).toBe("false"));
      expect(view.queryByRole("alert")).toBeNull();
      if (typeof value === "string") expect(view.getByText(value)).toBeTruthy();
      if (typeof value === "number")
        expect((view.getByRole("slider") as HTMLInputElement).value).toBe("0");
      if (typeof value === "boolean")
        expect((view.getByRole("checkbox") as HTMLInputElement).checked).toBe(
          false,
        );
    },
  );

  it("keeps an empty template leaf update behind the loader", async () => {
    const Render = renderer();
    const components = [
      {
        id: "root",
        component: "List",
        children: { componentId: "item", path: "/items" },
      },
      { id: "item", component: "Text", text: { "@path": "name" } },
    ];
    const view = render(
      <Render
        content={{
          a2ui_operations: [
            {
              version: "1.0",
              createSurface: { surfaceId: "native", catalogId: V1_CATALOG },
            },
            {
              version: "1.0",
              updateComponents: { surfaceId: "native", components },
            },
            {
              version: "1.0",
              updateDataModel: {
                surfaceId: "native",
                path: "/items",
                value: [],
              },
            },
          ],
        }}
        agent={null}
      />,
    );
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(visible(view)).toBe("true");
  });

  it("does not reveal an empty template for an unrelated scalar leaf update", async () => {
    const Render = renderer();
    const components = [
      {
        id: "root",
        component: "List",
        children: { componentId: "item", path: "/items" },
      },
      { id: "item", component: "Text", text: { "@path": "name" } },
    ];
    const view = render(
      <Render
        content={{
          a2ui_operations: [
            ...inline(components).a2ui_operations,
            {
              version: "1.0",
              updateDataModel: {
                surfaceId: "native",
                path: "/items",
                value: [],
              },
            },
            {
              version: "1.0",
              updateDataModel: {
                surfaceId: "native",
                path: "/count",
                value: 0,
              },
            },
          ],
        }}
        agent={null}
      />,
    );
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(visible(view)).toBe("true");
  });

  it("paints repeating children when inline data arrives in a later snapshot", async () => {
    const Render = renderer();
    const components = [
      {
        id: "root",
        component: "List",
        children: { componentId: "item", path: "/items" },
      },
      { id: "item", component: "Text", text: { "@path": "name" } },
    ];
    const view = render(
      <Render content={inline(components, { items: [] })} agent={null} />,
    );
    const surface = view.container.querySelector("[data-surface-id=native]");
    expect(visible(view)).toBe("true");
    view.rerender(
      <Render
        content={inline(components, {
          items: [{ name: "Bolt A" }, { name: "Bolt B" }],
        })}
        agent={null}
      />,
    );
    await waitFor(() => expect(view.getByText("Bolt A")).toBeTruthy());
    expect(view.getByText("Bolt B")).toBeTruthy();
    await waitFor(() => expect(visible(view)).toBe("false"));
    expect(view.container.querySelector("[data-surface-id=native]")).toBe(
      surface,
    );
  });

  it("keeps legacy and native cards mounted while they update independently", async () => {
    const Render = renderer();
    const content = (legacy: string, native: string) => ({
      a2ui_operations: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "legacy", catalogId: V09_CATALOG },
        },
        {
          version: "v0.9",
          updateComponents: { surfaceId: "legacy", components: text(legacy) },
        },
        ...inline(text(native)).a2ui_operations,
      ],
    });
    const view = render(
      <Render content={content("Legacy", "Native")} agent={null} />,
    );
    expect(view.getByText("Legacy")).toBeTruthy();
    expect(view.getByText("Native")).toBeTruthy();
    const legacy = view.container.querySelector("[data-surface-id=legacy]");
    const native = view.container.querySelector("[data-surface-id=native]");
    view.rerender(
      <Render
        content={content("Legacy updated", "Native updated")}
        agent={null}
      />,
    );
    await waitFor(() => expect(view.getByText("Native updated")).toBeTruthy());
    expect(view.getByText("Legacy updated")).toBeTruthy();
    expect(view.container.querySelector("[data-surface-id=legacy]")).toBe(
      legacy,
    );
    expect(view.container.querySelector("[data-surface-id=native]")).toBe(
      native,
    );
  });

  it("rejects a version-changing repeated create and preserves the old card", async () => {
    const Render = renderer();
    const original = {
      a2ui_operations: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "native", catalogId: V09_CATALOG },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "native",
            components: text("Original card"),
          },
        },
      ],
    };
    const view = render(<Render content={original} agent={null} />);
    expect(view.getByText("Original card")).toBeTruthy();
    view.rerender(
      <Render content={inline(text("Wrong protocol"))} agent={null} />,
    );
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toMatch(/version/i),
    );
    expect(view.getByText("Original card")).toBeTruthy();
    expect(view.queryByText("Wrong protocol")).toBeNull();
  });

  it("reports malformed native routing envelopes visibly rather than stripping them", async () => {
    const Render = renderer();
    const operation = inline(text("Invalid native envelope"))
      .a2ui_operations[0];
    const view = render(
      <Render
        content={{ a2ui_operations: [{ ...operation, surfaceId: "native" }] }}
        agent={null}
      />,
    );
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toMatch(/surfaceId/),
    );
    await waitFor(() => expect(visible(view)).toBe("false"));
    expect(view.queryByText("Invalid native envelope")).toBeNull();
  });

  it("rejects a noncanonical native version on a repeated create", async () => {
    const Render = renderer();
    const view = render(
      <Render content={inline(text("Original card"))} agent={null} />,
    );
    const operation = inline(text("Noncanonical update")).a2ui_operations[0];
    view.rerender(
      <Render
        content={{ a2ui_operations: [{ ...operation, version: "v1.0" }] }}
        agent={null}
      />,
    );
    await waitFor(() =>
      expect(view.getAllByRole("alert")[0].textContent).toMatch(/version|1.0/),
    );
    expect(view.getByText("Original card")).toBeTruthy();
    expect(view.queryByText("Noncanonical update")).toBeNull();
  });

  it("validates repeated native creates before replaying their inline fields", async () => {
    const Render = renderer();
    const view = render(
      <Render content={inline(text("Original card"))} agent={null} />,
    );
    const operation = inline(text("Invalid update")).a2ui_operations[0];
    view.rerender(
      <Render
        content={{
          a2ui_operations: [
            {
              ...operation,
              createSurface: {
                ...operation.createSurface,
                sendDataModel: "invalid",
              },
            },
          ],
        }}
        agent={null}
      />,
    );
    await waitFor(() =>
      expect(view.getAllByRole("alert")[0].textContent).toMatch(
        /sendDataModel|boolean/,
      ),
    );
    expect(view.getByText("Original card")).toBeTruthy();
    expect(view.queryByText("Invalid update")).toBeNull();
  });

  it.each([{ name: "Ada" }, {}])(
    "preserves local edits when a fresh snapshot repeats unchanged inline initialization %j",
    async (initialData) => {
      const onAction = vi.fn(() => null);
      const Render = renderer(onAction);
      const wireSnapshot = JSON.stringify(
        inline(
          [
            {
              id: "root",
              component: "Column",
              children: ["field", "status", "submit"],
            },
            {
              id: "field",
              component: "TextField",
              label: "Name",
              value: { "@path": "/name" },
            },
            { id: "status", component: "Text", text: "Initial status" },
            {
              id: "submit",
              component: "Button",
              child: "label",
              action: {
                event: {
                  name: "save",
                  context: { name: { "@path": "/name" } },
                },
              },
            },
            { id: "label", component: "Text", text: "Save" },
          ],
          initialData,
        ),
      );
      const view = render(
        <Render content={JSON.parse(wireSnapshot)} agent={{}} />,
      );
      fireEvent.change(view.getByLabelText("Name"), {
        target: { value: "Grace" },
      });
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Grace",
      );

      // Deserialize the original wire content again: SDK binding edits can mutate
      // the first snapshot's data object and otherwise mask an initialization replay.
      const nextSnapshot = JSON.parse(wireSnapshot);
      nextSnapshot.a2ui_operations.push({
        version: "1.0",
        updateComponents: {
          surfaceId: "native",
          components: [
            { id: "status", component: "Text", text: "Updated status" },
          ],
        },
      });
      view.rerender(<Render content={nextSnapshot} agent={{}} />);
      await waitFor(() =>
        expect(view.getByText("Updated status")).toBeTruthy(),
      );
      fireEvent.click(view.getByRole("button", { name: "Save", hidden: true }));
      await waitFor(() =>
        expect(onAction).toHaveBeenCalledWith(
          expect.objectContaining({ name: "save", context: { name: "Grace" } }),
          expect.any(Function),
        ),
      );
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Grace",
      );

      // Deletion starts a new surface lifecycle even with the same initialization.
      const recreated = JSON.parse(wireSnapshot);
      recreated.a2ui_operations.unshift({
        version: "1.0",
        deleteSurface: { surfaceId: "native" },
      });
      view.rerender(<Render content={recreated} agent={{}} />);
      await waitFor(() =>
        expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
          initialData.name ?? "",
        ),
      );
    },
  );

  it("forwards edited native form values, functions and the action userMessage", async () => {
    const onAction = vi.fn(() => null);
    const Render = renderer(onAction);
    const components = [
      {
        id: "root",
        component: "Column",
        children: ["field", "list", "total", "submit"],
      },
      {
        id: "field",
        component: "TextField",
        label: "Name",
        value: { "@path": "/name" },
      },
      {
        id: "list",
        component: "List",
        children: { componentId: "item", path: "/items" },
      },
      { id: "item", component: "Text", text: { "@path": "name" } },
      {
        id: "total",
        component: "Text",
        text: { "@call": "formatNumber", args: { value: 1234, decimals: 0 } },
      },
      {
        id: "submit",
        component: "Button",
        child: "label",
        action: {
          event: {
            name: "save",
            userMessage: "Save the form",
            context: { name: { "@path": "/name" } },
          },
        },
      },
      { id: "label", component: "Text", text: "Save" },
    ];
    const view = render(
      <Render
        content={inline(components, { name: "Ada", items: [{ name: "Item" }] })}
        agent={{}}
      />,
    );
    expect(view.getByText("1,234")).toBeTruthy();
    expect(view.getByText("Item")).toBeTruthy();
    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Grace" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save", hidden: true }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "save",
          userMessage: "Save the form",
          context: { name: "Grace" },
        }),
        expect.any(Function),
      ),
    );
  });
});
