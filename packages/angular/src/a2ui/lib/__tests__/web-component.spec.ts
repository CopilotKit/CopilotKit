import { Component, signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ComponentContext } from "@a2ui/web_core/v0_9";
import { createAngularCatalog } from "../create-catalog";
import { CopilotA2UISurface } from "../surface";
import { registerUniversalElement } from "../universal";

/** Renders its `label` prop and counts the contexts it was handed. */
class BadgeElement extends HTMLElement {
  contexts = 0;
  #context?: ComponentContext;

  get context(): ComponentContext | undefined {
    return this.#context;
  }

  set context(context: ComponentContext | undefined) {
    this.#context = context;
    this.contexts++;
    this.textContent = String(context?.componentModel.properties["label"]);
  }
}

const catalog = createAngularCatalog(
  { Badge: { props: z.object({ label: z.string() }) } },
  { Badge: { tagName: "test-a2ui-badge", element: BadgeElement } },
  { catalogId: "copilotkit://web-component-test", includeBasicCatalog: true },
);

@Component({
  imports: [CopilotA2UISurface],
  template: `
    <copilot-a2ui-surface [operations]="operations()" [catalog]="catalog" />
  `,
})
class HostComponent {
  readonly operations = signal<unknown[]>([]);
  readonly catalog = catalog;
}

function badge(label: string) {
  return {
    version: "v0.9",
    updateComponents: {
      surfaceId: "default",
      components: [
        { id: "root", component: "Column", children: ["badge"] },
        { id: "badge", component: "Badge", label },
      ],
    },
  };
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

describe("Custom Element catalog entries", () => {
  it("renders the entry's element inside Angular components and hands it the node's context", async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    const element = await render(fixture, [badge("New")]);

    const badgeElement = element.querySelector("test-a2ui-badge");
    expect(badgeElement).toBeInstanceOf(BadgeElement);
    expect((badgeElement as BadgeElement).context?.componentModel.id).toBe(
      "badge",
    );
    expect(badgeElement?.textContent).toBe("New");
  });

  it("keeps the element and hands it a fresh context when the component updates", async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    const element = await render(fixture, [badge("New")]);
    const original = element.querySelector("test-a2ui-badge") as BadgeElement;
    const contexts = original.contexts;

    await render(fixture, [badge("New"), badge("Shipped")]);

    expect(element.querySelector("test-a2ui-badge")).toBe(original);
    expect(original.contexts).toBeGreaterThan(contexts);
    expect(original.textContent).toBe("Shipped");
  });
});

describe("Custom Element cleanup", () => {
  it("removes the element when its node becomes another component", async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    const element = await render(fixture, [badge("New")]);
    expect(element.querySelector("test-a2ui-badge")).not.toBeNull();

    await render(fixture, [
      badge("New"),
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "default",
          components: [{ id: "badge", component: "Text", text: "Plain" }],
        },
      },
    ]);

    expect(element.querySelector("test-a2ui-badge")).toBeNull();
    expect(element.textContent).toContain("Plain");
  });
});

describe("registerUniversalElement", () => {
  it("rejects a different element under a registered tag name", () => {
    const entry = {
      name: "Badge",
      schema: z.object({}),
      tagName: "test-a2ui-collision",
      element: class extends HTMLElement {},
    };
    registerUniversalElement(entry);
    registerUniversalElement(entry);

    expect(() =>
      registerUniversalElement({
        ...entry,
        element: class extends HTMLElement {},
      }),
    ).toThrow(/tag name collision/);
  });
});
