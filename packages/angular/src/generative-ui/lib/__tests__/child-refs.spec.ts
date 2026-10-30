import { Component, input } from "@angular/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  GenerativeUISurfaceManager,
  buildCompactGenerativeUISchema,
  buildGenerativeUIManifest,
  createGenerativeUIDispatcher,
} from "@copilotkit/core/generative-ui";
import { child, childList, createGenerativeUI } from "../catalog";
import type { GenerativeUIChildren } from "../children";
import { CopilotGenerativeUIChildren } from "../children.directive";
import { standardUI } from "../standard";
import { renderSurface } from "./render";
import { textOf } from "./dom";

@Component({
  selector: "test-text",
  template: `
    <span data-text>{{ text() }}</span>
  `,
})
class Text {
  readonly text = input<string | number>();
}

@Component({
  selector: "test-tabs",
  imports: [CopilotGenerativeUIChildren],
  template: `
    @for (tab of tabs(); track tab.title) {
      <section [attr.data-tab]="tab.title">
        <ng-container *copilotGenerativeUIChildren="tab.child" />
      </section>
    }
  `,
})
class Tabs {
  readonly tabs =
    input<Array<{ title: string; child: GenerativeUIChildren }>>();
}

@Component({
  selector: "test-deck",
  imports: [CopilotGenerativeUIChildren],
  template: `
    @for (slide of slides(); track slide.name) {
      <section [attr.data-slide]="slide.name">
        <ng-container *copilotGenerativeUIChildren="slide.items" />
      </section>
    }
  `,
})
class Deck {
  readonly slides =
    input<Array<{ name: string; items: GenerativeUIChildren }>>();
}

@Component({
  selector: "test-column",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div><ng-container *copilotGenerativeUIChildren="children()" /></div>
  `,
})
class Column {
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "test-box",
  template: `
    <span>{{ value() }}</span>
  `,
})
class Box {
  readonly value = input<unknown>();
  readonly item = input<unknown>();
}

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
  it("renders a child() inside a list prop, in place of the id", () => {
    const view = renderSurface(ui, [
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
    expect(textOf(view.container, '[data-tab="A"]')).toBe("panel a");
    expect(textOf(view.container, '[data-tab="B"]')).toBe("panel b");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("renders a childList() inside a list prop, with ids and with a template", () => {
    const view = renderSurface(
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
    expect(textOf(view.container, '[data-slide="ids"]')).toBe("xy");
    expect(textOf(view.container, '[data-slide="tpl"]')).toBe("AdaLinus");
  });

  it("resolves a bound list of tabs from the data model before rendering its children", () => {
    const view = renderSurface(
      ui,
      [
        { id: "root", component: "Tabs", tabs: { "@path": "/tabs" } },
        { id: "a", component: "Text", text: "from data" },
      ],
      { tabs: [{ title: "A", child: "a" }] },
    );
    expect(textOf(view.container, '[data-tab="A"]')).toBe("from data");
  });

  it("shows the prop as componentId in the compact schema and keeps the manifest serializable", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    const dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    });
    const manifest = buildGenerativeUIManifest(
      { ui, manager, dispatcher },
      undefined,
    );
    const compact = buildCompactGenerativeUISchema(manifest);
    expect(compact.components.Tabs!.props).toEqual({
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
    expect(Described.manifestComponents.Box!.props).toEqual({
      type: "object",
      properties: {
        child: { $ref: expect.any(String), description: "The panel" },
      },
      required: ["child"],
      additionalProperties: false,
    });
    expect(compact.components.Deck!.props.slides).toBe(
      "{ name: string; items: componentId[] | { componentId: string; path: string } }[]",
    );
    expect(JSON.parse(JSON.stringify(manifest.components.Tabs!.props))).toEqual(
      manifest.components.Tabs!.props,
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

describe("standard Tabs", () => {
  it("renders Tabs from typed child references", () => {
    const view = renderSurface(standardUI, [
      {
        id: "root",
        component: "Tabs",
        tabs: [
          { title: "One", child: "a" },
          { title: "Two", child: "b" },
        ],
      },
      { id: "a", component: "Text", text: "panel one" },
      { id: "b", component: "Text", text: "panel two" },
    ]);
    expect(textOf(view.container, '[role="tabpanel"]')).toBe("panel one");
    const two = [
      ...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.textContent?.trim() === "Two")!;
    view.act(() => two.click());
    expect(textOf(view.container, '[role="tabpanel"]')).toBe("panel two");
    expect(view.reportError).not.toHaveBeenCalled();
  });
});
