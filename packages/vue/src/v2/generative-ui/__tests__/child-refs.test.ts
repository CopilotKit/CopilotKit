import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import type { PropType, VNode } from "vue";
import { z } from "zod";
import {
  buildGenerativeUIManifest,
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import { buildCompactGenerativeUISchema } from "@copilotkit/shared";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import { child, childList } from "../refs";
import { renderSurface } from "./helpers/render-surface";

const Text = defineComponent({
  props: { text: { type: [String, Number], required: true } },
  template: `<span data-testid="text">{{ String(text) }}</span>`,
});
const Tabs = defineComponent({
  props: {
    tabs: {
      type: Array as PropType<Array<{ title: string; child: VNode }>>,
      required: true,
    },
  },
  template: `
    <div>
      <section v-for="tab in tabs" :key="tab.title" :data-testid="'tab-' + tab.title">
        <component :is="tab.child" />
      </section>
    </div>
  `,
});
const Deck = defineComponent({
  props: {
    slides: {
      type: Array as PropType<Array<{ name: string; items: VNode }>>,
      required: true,
    },
  },
  template: `
    <div>
      <section v-for="slide in slides" :key="slide.name" :data-testid="'slide-' + slide.name">
        <component :is="slide.items" />
      </section>
    </div>
  `,
});
const Column = defineComponent({
  template: `<div><slot name="children" /></div>`,
});
const Box = defineComponent({
  props: { value: { type: null, default: undefined } },
  template: `<span>{{ String(value) }}</span>`,
});

const ui = createGenerativeUI({
  id: "test",
  components: {
    Column: { component: Column, slots: { children: "multiple" } },
    Text: {
      component: Text,
      props: z.object({ text: z.union([z.string(), z.number()]) }),
    },
    Tabs: {
      component: Tabs,
      props: z.object({
        tabs: z.array(z.object({ title: z.string(), child: child() })),
      }),
    },
    Deck: {
      component: Deck,
      props: z.object({
        slides: z.array(z.object({ name: z.string(), items: childList() })),
      }),
    },
  },
});

describe("typed child references", () => {
  it("renders a child() inside a list prop, in place of the id", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Tabs",
        tabs: [
          { title: "A", child: "a" },
          { title: "B", child: "b" },
        ],
      },
      { id: "a", component: "Text", text: "panel a" },
      { id: "b", component: "Text", text: "panel b" },
    ]);
    expect((await v.findByTestId("tab-A")).textContent).toBe("panel a");
    expect(v.getByTestId("tab-B").textContent).toBe("panel b");
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("renders a childList() inside a list prop, with ids and with a template", async () => {
    const v = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Deck",
          slides: [
            { name: "ids", items: ["x", "y"] },
            { name: "tpl", items: { componentId: "row", path: "/people" } },
          ],
        },
        { id: "x", component: "Text", text: "x" },
        { id: "y", component: "Text", text: "y" },
        { id: "row", component: "Text", text: { "@path": "name" } },
      ],
      { people: [{ name: "Ada" }, { name: "Linus" }] },
    );
    expect((await v.findByTestId("slide-ids")).textContent).toBe("xy");
    expect(v.getByTestId("slide-tpl").textContent).toBe("AdaLinus");
  });

  it("resolves a bound list of tabs from the data model before rendering its children", async () => {
    const v = renderSurface(
      ui,
      [
        { id: "root", component: "Tabs", tabs: { "@path": "/tabs" } },
        { id: "a", component: "Text", text: "from data" },
      ],
      { tabs: [{ title: "A", child: "a" }] },
    );
    expect((await v.findByTestId("tab-A")).textContent).toBe("from data");
  });

  it("shows the prop as componentId in the compact schema and keeps the manifest serializable", () => {
    // The engine's `ui` type takes function and class components only.
    const engineUI: AnyGenerativeUI = ui;
    const manager = new GenerativeUISurfaceManager(engineUI);
    const dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    });
    const manifest = buildGenerativeUIManifest(
      { ui: engineUI, manager, dispatcher },
      undefined,
    );
    const compact = buildCompactGenerativeUISchema(manifest);
    expect(compact.components.Tabs.props).toEqual({
      tabs: "{ title: string; child: componentId }[]",
    });
    // A description given to child() survives next to the reference.
    const Described = createGenerativeUI({
      id: "d",
      components: {
        Box: {
          component: Column,
          props: z.object({ child: child("The panel") }),
        },
      },
    });
    expect(Described.manifestComponents.Box.props).toEqual({
      type: "object",
      properties: {
        child: { $ref: expect.any(String), description: "The panel" },
      },
      required: ["child"],
      additionalProperties: false,
    });
    expect(compact.components.Deck.props.slides).toBe(
      "{ name: string; items: componentId[] | { componentId: string; path: string } }[]",
    );
    expect(JSON.parse(JSON.stringify(manifest.components.Tabs.props))).toEqual(
      manifest.components.Tabs.props,
    );
  });
});

describe("collectChildRefs through createGenerativeUI", () => {
  it("does not treat a prop as a reference when only one union branch is one", () => {
    const mixed = createGenerativeUI({
      id: "mixed",
      components: {
        Box: {
          component: Box,
          props: z.object({ value: z.union([z.string(), child()]) }),
        },
        Both: {
          component: Box,
          props: z.object({ value: z.union([child(), child()]) }),
        },
      },
    });
    expect(mixed.components.get("Box")?.childRefs).toEqual([]);
    expect(mixed.components.get("Both")?.childRefs).toEqual([
      { path: ["value"], kind: "single" },
    ]);
  });

  it("keeps only the nested references that every object alternative of a union shares", () => {
    const mixed = createGenerativeUI({
      id: "mixed2",
      components: {
        Box: {
          component: Box,
          props: z.object({
            item: z.union([
              z.object({
                kind: z.literal("text"),
                content: z.string(),
                aside: child(),
              }),
              z.object({
                kind: z.literal("node"),
                content: child(),
                aside: child(),
              }),
            ]),
          }),
        },
      },
    });
    expect(mixed.components.get("Box")?.childRefs).toEqual([
      { path: ["item", "aside"], kind: "single" },
    ]);
  });
});
