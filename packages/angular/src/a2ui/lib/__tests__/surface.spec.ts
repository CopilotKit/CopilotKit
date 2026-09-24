import { Component, input, signal, type Type } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { A2UIClientEventMessage } from "@copilotkit/a2ui-renderer/web-components";
import { CopilotA2UIChild } from "../child";
import { injectA2UIComponentContext } from "../component-context";
import { createAngularCatalog } from "../create-catalog";
import { CopilotA2UISurface } from "../surface";
import type { A2UISurfaceError } from "@copilotkit/angular";
import type { A2UICatalogDefinitions, A2UIProps } from "../types";
import {
  ActionSchema,
  ChildListSchema,
  DynamicStringSchema,
} from "@a2ui/web_core/v0_9";

const definitions = {
  Column: {
    props: z.object({ gap: z.number().optional(), children: ChildListSchema }),
  },
  Text: { props: z.object({ text: DynamicStringSchema }) },
  Metric: { props: z.object({ label: z.string(), value: z.string() }) },
  Button: {
    props: z.object({ label: z.string(), action: ActionSchema.optional() }),
  },
  Input: { props: z.object({ value: DynamicStringSchema }) },
} satisfies A2UICatalogDefinitions;

type Props<K extends keyof typeof definitions> = A2UIProps<
  typeof definitions,
  K
>;

@Component({
  selector: "test-column",
  imports: [CopilotA2UIChild],
  template: `
    <div data-testid="column" [attr.data-gap]="props().gap ?? 0">
      @for (child of props().children; track child.id + child.basePath) {
        <copilot-a2ui-child [child]="child" />
      }
    </div>
  `,
})
class ColumnComponent {
  readonly props = input.required<Props<"Column">>();
}

@Component({
  selector: "test-text",
  template: `
    <p data-testid="text">{{ props().text }}</p>
  `,
})
class TextComponent {
  readonly props = input.required<Props<"Text">>();
}

@Component({
  selector: "test-metric",
  template: `
    <span data-testid="metric">{{ label() }}={{ value() }}</span>
  `,
})
class MetricComponent {
  static created = 0;
  readonly label = input.required<string>();
  readonly value = input.required<string>();

  constructor() {
    MetricComponent.created += 1;
  }
}

@Component({
  selector: "test-button",
  template: `
    <button type="button" data-testid="button" (click)="props().action?.()">
      {{ props().label }}
    </button>
    <button type="button" data-testid="dispatch" (click)="dispatch()">
      manual
    </button>
  `,
})
class ButtonComponent {
  readonly props = input.required<Props<"Button">>();
  private readonly context = injectA2UIComponentContext();

  dispatch(): void {
    void this.context.dispatch({
      event: {
        name: "manual",
        context: {
          from: this.context.componentId,
          path: this.context.basePath,
        },
      },
    });
  }
}

@Component({
  selector: "test-input",
  template: `
    <input
      data-testid="input"
      [value]="props().value ?? ''"
      (input)="props().setValue($any($event.target).value)"
    />
  `,
})
class InputComponent {
  readonly props = input.required<Props<"Input">>();
}

@Component({
  selector: "test-loading",
  template: `
    <div data-testid="custom-loading">{{ label }}</div>
  `,
})
class LoadingComponent {
  readonly label = "Custom loading";
}

const catalog = createAngularCatalog(
  definitions,
  {
    Column: ColumnComponent,
    Text: TextComponent,
    Metric: MetricComponent,
    Button: ButtonComponent,
    Input: InputComponent,
  },
  { catalogId: "copilotkit://test-catalog" },
);

@Component({
  imports: [CopilotA2UISurface],
  template: `
    <copilot-a2ui-surface
      [operations]="operations()"
      [catalog]="catalog"
      [theme]="theme"
      [loadingComponent]="loadingComponent()"
      (action)="actions.push($event)"
      (error)="errors.push($event)"
      (rendered)="rendered = rendered + 1"
    />
  `,
})
class HostComponent {
  readonly operations = signal<unknown[]>([]);
  readonly loadingComponent = signal<Type<unknown> | undefined>(undefined);
  readonly catalog = catalog;
  readonly theme = { accent: "blue" };
  readonly actions: A2UIClientEventMessage[] = [];
  readonly errors: A2UISurfaceError[] = [];
  rendered = 0;
}

function updateComponents(surfaceId: string, components: unknown[]) {
  return { version: "v0.9", updateComponents: { surfaceId, components } };
}

function updateDataModel(surfaceId: string, value: unknown, path = "/") {
  return { version: "v0.9", updateDataModel: { surfaceId, path, value } };
}

async function render(
  fixture: ComponentFixture<HostComponent>,
  operations: unknown[],
): Promise<HTMLElement> {
  fixture.componentInstance.operations.set(operations);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe("CopilotA2UISurface", () => {
  const setup = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    return TestBed.createComponent(HostComponent);
  };

  it("renders registered components, binds props by convention, and nests children", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Column", gap: 8, children: ["title", "kpi"] },
        { id: "title", component: "Text", text: "Hello" },
        { id: "kpi", component: "Metric", label: "Revenue", value: "$1" },
      ]),
    ]);

    const column = element.querySelector('[data-testid="column"]');
    expect(column?.getAttribute("data-gap")).toBe("8");
    expect(column?.querySelector('[data-testid="text"]')?.textContent).toBe(
      "Hello",
    );
    expect(column?.querySelector('[data-testid="metric"]')?.textContent).toBe(
      "Revenue=$1",
    );
    expect(element.querySelector('[data-surface-id="default"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="a2ui-loading"]')).toBeNull();
    expect(fixture.componentInstance.rendered).toBe(1);
    expect(fixture.componentInstance.errors).toEqual([]);
  });

  it("resolves data bindings and updates when the data model changes", async () => {
    const fixture = setup();
    const operations = [
      updateDataModel("default", { title: "First" }),
      updateComponents("default", [
        { id: "root", component: "Text", text: { path: "/title" } },
      ]),
    ];
    const element = await render(fixture, operations);
    expect(element.querySelector('[data-testid="text"]')?.textContent).toBe(
      "First",
    );

    await render(fixture, [
      ...operations,
      updateDataModel("default", { title: "Second" }),
    ]);
    expect(element.querySelector('[data-testid="text"]')?.textContent).toBe(
      "Second",
    );
  });

  it("renders template child lists once per data item with scoped paths", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      updateDataModel("default", {
        items: [{ name: "One" }, { name: "Two" }],
      }),
      updateComponents("default", [
        {
          id: "root",
          component: "Column",
          children: { componentId: "item", path: "/items" },
        },
        { id: "item", component: "Text", text: { path: "name" } },
      ]),
    ]);

    const texts = [...element.querySelectorAll('[data-testid="text"]')].map(
      (node) => node.textContent,
    );
    expect(texts).toEqual(["One", "Two"]);
  });

  it("dispatches actions from resolved closures and from the component context", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      updateComponents("default", [
        {
          id: "root",
          component: "Button",
          label: "Confirm",
          action: { event: { name: "confirm", context: { id: "b1" } } },
        },
      ]),
    ]);

    (element.querySelector('[data-testid="button"]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.actions).toHaveLength(1),
    );
    expect(fixture.componentInstance.actions[0]?.userAction).toMatchObject({
      name: "confirm",
      surfaceId: "default",
      sourceComponentId: "root",
      context: { id: "b1" },
    });

    (element.querySelector('[data-testid="dispatch"]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.actions).toHaveLength(2),
    );
    expect(fixture.componentInstance.actions[1]?.userAction).toMatchObject({
      name: "manual",
      sourceComponentId: "root",
      context: { from: "root", path: "/" },
    });
  });

  it("writes two-way bindings back into the data model", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      updateDataModel("default", { query: "" }),
      updateComponents("default", [
        { id: "root", component: "Column", children: ["field", "echo"] },
        { id: "field", component: "Input", value: { path: "/query" } },
        { id: "echo", component: "Text", text: { path: "/query" } },
      ]),
    ]);

    const field = element.querySelector(
      '[data-testid="input"]',
    ) as HTMLInputElement;
    field.value = "typed";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="text"]')?.textContent).toBe(
      "typed",
    );
  });

  it("shows loading UI until a surface renders and reports unknown components", async () => {
    const fixture = setup();
    let element = await render(fixture, []);
    expect(
      element.querySelector('[data-testid="a2ui-loading"]'),
    ).not.toBeNull();

    fixture.componentInstance.loadingComponent.set(LoadingComponent);
    element = await render(fixture, []);
    expect(element.querySelector('[data-testid="a2ui-loading"]')).toBeNull();
    expect(
      element.querySelector('[data-testid="custom-loading"]')?.textContent,
    ).toBe("Custom loading");

    element = await render(fixture, [
      updateComponents("default", [{ id: "root", component: "Nope" }]),
    ]);
    expect(
      element.querySelector('[data-testid="a2ui-node-unknown"]')?.textContent,
    ).toContain("Nope");
  });

  it("shows a placeholder for children that have not arrived yet", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Column", children: ["later"] },
      ]),
    ]);
    expect(
      element.querySelector('[data-testid="a2ui-node-placeholder"]'),
    ).not.toBeNull();

    await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Column", children: ["later"] },
        { id: "later", component: "Text", text: "Arrived" },
      ]),
    ]);
    expect(
      element.querySelector('[data-testid="a2ui-node-placeholder"]'),
    ).toBeNull();
    expect(element.querySelector('[data-testid="text"]')?.textContent).toBe(
      "Arrived",
    );
  });

  it("pins surfaces to the configured catalog and renders surfaces independently", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "one",
          catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
        },
      },
      updateComponents("one", [{ id: "root", component: "Text", text: "One" }]),
      updateComponents("two", [{ id: "root", component: "Text", text: "Two" }]),
    ]);

    expect(fixture.componentInstance.errors).toEqual([]);
    expect(
      element.querySelector('[data-surface-id="one"] [data-testid="text"]')
        ?.textContent,
    ).toBe("One");
    expect(
      element.querySelector('[data-surface-id="two"] [data-testid="text"]')
        ?.textContent,
    ).toBe("Two");
    expect(fixture.componentInstance.rendered).toBe(1);
  });

  it("keeps per-input components when a streamed prop arrives", async () => {
    const fixture = setup();
    MetricComponent.created = 0;
    let element = await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Metric", label: "Revenue" },
      ]),
    ]);
    expect(element.querySelector('[data-testid="metric"]')?.textContent).toBe(
      "Revenue=",
    );

    element = await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Metric", label: "Revenue", value: "$1" },
      ]),
    ]);
    expect(element.querySelector('[data-testid="metric"]')?.textContent).toBe(
      "Revenue=$1",
    );
    expect(MetricComponent.created).toBe(1);
  });

  it("clears props the agent removes", async () => {
    const fixture = setup();
    await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Metric", label: "Revenue", value: "$1" },
      ]),
    ]);
    const element = await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Metric", label: "Revenue", value: "$1" },
      ]),
      updateComponents("default", [
        { id: "root", component: "Metric", label: "Revenue" },
      ]),
    ]);

    expect(element.querySelector('[data-testid="metric"]')?.textContent).toBe(
      "Revenue=",
    );
  });

  it("starts over when the operations are cleared", async () => {
    const fixture = setup();
    await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Column", children: ["a"] },
        { id: "a", component: "Text", text: "stale" },
      ]),
    ]);
    await render(fixture, []);
    const element = await render(fixture, [
      updateComponents("default", [
        { id: "root", component: "Column", children: ["a"] },
      ]),
    ]);

    expect(element.querySelector('[data-testid="text"]')).toBeNull();
    expect(
      element.querySelector('[data-testid="a2ui-node-placeholder"]'),
    ).not.toBeNull();
  });

  it("exposes the surface theme's primary color as a CSS variable", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "themed",
          catalogId: "copilotkit://test-catalog",
          theme: { primaryColor: "#e11d48" },
        },
      },
      updateComponents("themed", [
        { id: "root", component: "Text", text: "Hi" },
      ]),
    ]);

    expect(
      element
        .querySelector<HTMLElement>('.a2ui-surface[data-surface-id="themed"]')
        ?.style.getPropertyValue("--a2ui-color-primary"),
    ).toBe("#e11d48");
  });

  it("surfaces processing failures through the error output", async () => {
    const fixture = setup();
    const element = await render(fixture, [
      updateComponents("broken", [{ component: "Text" }]),
    ]);

    expect(fixture.componentInstance.errors).toHaveLength(1);
    expect(
      element.querySelector('[data-testid="a2ui-error"]')?.textContent,
    ).toContain("A2UI render error");
  });
});
