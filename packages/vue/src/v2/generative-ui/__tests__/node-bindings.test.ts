import { describe, expect, it } from "vitest";
import { defineComponent, inject } from "vue";
import type { PropType } from "vue";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";
import { GenerativeUINodeKey } from "../runtime-context";
import { renderSurface, SURFACE_ID } from "./helpers/render-surface";

// How a generated Vue component gets its props, events and node context.
// React has no counterpart suite: React passes everything as props, and
// re-renders a component on every render of its parent.

const Rows = defineComponent({
  props: {
    rows: {
      type: Array as PropType<Array<{ label: string }>>,
      required: true,
    },
  },
  template: `<ul><li v-for="row in rows" :key="row.label">{{ row.label }}</li></ul>`,
});
const Where = defineComponent({
  props: { label: { type: String, required: true } },
  setup() {
    return { node: inject(GenerativeUINodeKey) };
  },
  template: `<span data-testid="where">{{ label }}@{{ node.surfaceId }}/{{ node.componentId }}</span>`,
});
const Column = defineComponent({
  template: `<div><slot name="children" /></div>`,
});
const Plain = defineComponent({
  template: `<p data-testid="plain">plain</p>`,
});

const ui = createGenerativeUI({
  id: "bindings",
  components: {
    Rows: {
      component: Rows,
      props: z.object({ rows: z.array(z.object({ label: z.string() })) }),
    },
    Where: { component: Where, props: z.object({ label: z.string() }) },
    Column: { component: Column, slots: { children: "multiple" } },
    Plain: { component: Plain, props: z.object({ tone: z.string() }) },
  },
});

const setData = (path: string, value: unknown) => ({
  version: "1.0" as const,
  updateDataModel: { surfaceId: SURFACE_ID, path, value },
});
const labels = (element: HTMLElement) =>
  [...element.querySelectorAll("li")].map((item) => item.textContent);

describe("SurfaceView node bindings (Vue-specific semantics)", () => {
  it("updates a bound list prop when the data model changes an item of the list in place", async () => {
    const v = renderSurface(
      ui,
      [{ id: "root", component: "Rows", rows: { "@path": "/rows" } }],
      { rows: [{ label: "a" }, { label: "b" }] },
    );
    const list = await v.findByRole("list");
    expect(labels(list)).toEqual(["a", "b"]);

    await v.update(setData("/rows/1/label", "b2"));
    expect(labels(list)).toEqual(["a", "b2"]);
  });

  it("provides the node context to each component, also to a template item", async () => {
    const v = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Column",
          children: { componentId: "row", path: "/items" },
        },
        { id: "row", component: "Where", label: { "@path": "name" } },
      ],
      { items: [{ name: "x" }, { name: "y" }] },
    );
    const items = await v.findAllByTestId("where");
    expect(items.map((item) => item.textContent)).toEqual([
      `x@${SURFACE_ID}/row`,
      `y@${SURFACE_ID}/row`,
    ]);
  });

  it("gives a data prop that the component does not declare to its root element as an attribute", async () => {
    const v = renderSurface(ui, [
      { id: "root", component: "Plain", tone: "calm" },
    ]);
    const plain = await v.findByTestId("plain");
    expect(plain.getAttribute("tone")).toBe("calm");
  });
});
