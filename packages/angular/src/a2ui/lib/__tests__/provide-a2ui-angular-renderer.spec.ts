import {
  A2UI_RENDERER_CONFIG,
  A2uiRendererService,
  BasicCatalog,
  provideMarkdownRenderer,
  type BoundProperty,
} from "@a2ui/angular/v0_9";
import { Component, EnvironmentInjector, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { CopilotKit, provideCopilotKit } from "@copilotkit/angular";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { A2UIAngularCatalog } from "../a2ui-angular-catalog";
import { A2UI_CATALOG_CONTEXT_DESCRIPTION } from "../a2ui-angular-catalog-context";
import { CopilotA2UIAngularActivityRenderer } from "../a2ui-angular-activity-renderer";
import { provideA2UIAngularRenderer } from "../provide-a2ui-angular-renderer";
import { installConstructableStyleSheetSupport } from "./constructable-stylesheet-support";

installConstructableStyleSheetSupport();

const CUSTOM_CATALOG_ID = "https://example.com/catalogs/test-catalog";

interface TestCardProps {
  title?: BoundProperty<string>;
}

@Component({
  template: `
    <span data-testid="test-card">{{ props().title?.value() ?? "" }}</span>
  `,
})
class TestCardComponent {
  readonly props = input<TestCardProps>({});
  readonly surfaceId = input<string>("");
  readonly componentId = input<string>("");
  readonly dataContextPath = input("/");
}

function customCatalog(): A2UIAngularCatalog {
  return {
    id: CUSTOM_CATALOG_ID,
    components: [
      {
        name: "TestCard",
        description: "A test card showing a title.",
        component: TestCardComponent,
        schema: z.object({
          title: z.union([z.string(), z.object({ path: z.string() }).strict()]),
        }),
      },
    ],
    functions: [
      {
        name: "double",
        description: "Doubles a number.",
        returnType: "number",
        schema: z.object({ value: z.number() }),
        execute: ({ value }) => value * 2,
      },
    ],
  };
}

describe("provideA2UIAngularRenderer", () => {
  it("registers the standard basic catalog when no catalog is given", () => {
    TestBed.configureTestingModule({
      providers: [provideA2UIAngularRenderer()],
    });

    const config = TestBed.inject(A2UI_RENDERER_CONFIG);

    expect(config.catalogs).toHaveLength(1);
    expect(config.catalogs[0]).toBeInstanceOf(BasicCatalog);
    expect(TestBed.inject(A2uiRendererService)).toBeTruthy();
  });

  it("extends the basic catalog with custom components and functions", () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({}),
        provideA2UIAngularRenderer(customCatalog()),
      ],
    });

    const config = TestBed.inject(A2UI_RENDERER_CONFIG);
    const catalog = config.catalogs[0];

    expect(catalog.id).toBe(CUSTOM_CATALOG_ID);
    expect(catalog.components.get("TestCard")?.component).toBe(
      TestCardComponent,
    );
    expect(catalog.components.has("Text")).toBe(true);
    expect(catalog.functions.has("double")).toBe(true);
  });

  it("validates function arguments before executing them", () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({}),
        provideA2UIAngularRenderer(customCatalog()),
      ],
    });

    const config = TestBed.inject(A2UI_RENDERER_CONFIG);
    const double = config.catalogs[0].functions.get("double");

    expect(
      double?.execute({ value: 21 }, undefined as never, undefined as never),
    ).toBe(42);
    expect(() =>
      double?.execute(
        { value: "not a number" },
        undefined as never,
        undefined as never,
      ),
    ).toThrow();
  });

  it("renders a custom Angular component emitted by the agent", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({}),
        provideA2UIAngularRenderer(customCatalog()),
        provideMarkdownRenderer(async (markdown) => markdown),
      ],
    });

    const fixture = TestBed.createComponent(CopilotA2UIAngularActivityRenderer);
    const content = {
      operations: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "surf-custom",
            catalogId: CUSTOM_CATALOG_ID,
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "surf-custom",
            components: [
              { id: "root", component: "Column", children: ["card"] },
              { id: "card", component: "TestCard", title: "Hello Custom" },
            ],
          },
        },
      ],
    };
    fixture.componentRef.setInput("activityType", "a2ui-surface");
    fixture.componentRef.setInput("content", content);
    fixture.componentRef.setInput("message", {
      id: "activity-1",
      role: "activity",
      activityType: "a2ui-surface",
      content,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '[data-testid="test-card"]',
    );
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Hello Custom");
  });

  function findCatalogContextEntry(copilotKit: CopilotKit) {
    return Object.values(copilotKit.core.context).find(
      (candidate) => candidate.description === A2UI_CATALOG_CONTEXT_DESCRIPTION,
    );
  }

  it("registers the catalog descriptor as agent context", () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({}),
        provideA2UIAngularRenderer(customCatalog()),
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const entry = findCatalogContextEntry(copilotKit);

    expect(entry).toBeDefined();
    const value = JSON.parse(entry!.value);
    expect(value.catalogId).toBe(CUSTOM_CATALOG_ID);
    expect(Object.keys(value.components)).toEqual(["TestCard"]);
    expect(value.components.TestCard.schema.properties.title).toBeDefined();
  });

  it("forwards only the catalog id when sendCatalogDescription is false", () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({}),
        provideA2UIAngularRenderer(customCatalog(), {
          sendCatalogDescription: false,
        }),
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const entry = findCatalogContextEntry(copilotKit);

    expect(entry).toBeDefined();
    expect(JSON.parse(entry!.value)).toEqual({
      catalogId: CUSTOM_CATALOG_ID,
      components: {},
    });
  });

  it("does not register catalog context when no catalog is given", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({}), provideA2UIAngularRenderer()],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    expect(findCatalogContextEntry(copilotKit)).toBeUndefined();
  });

  it("removes the catalog context when the injector is destroyed", () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({}),
        provideA2UIAngularRenderer(customCatalog()),
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    expect(findCatalogContextEntry(copilotKit)).toBeDefined();

    TestBed.inject(EnvironmentInjector).destroy();

    expect(findCatalogContextEntry(copilotKit)).toBeUndefined();
  });
});
