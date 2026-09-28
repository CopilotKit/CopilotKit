import { Component, signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { A2UIClientEventMessage } from "@copilotkit/a2ui-renderer/web-components";
import {
  basicCatalog as litBasicCatalog,
  buildCatalogContextValue,
} from "@copilotkit/a2ui-renderer/web-components";
import { basicCatalog } from "../basic/catalog";
import { CopilotA2UIText } from "../basic/text";
import { createAngularCatalog } from "../create-catalog";
import { CopilotA2UISurface } from "../surface";

@Component({
  selector: "test-badge",
  template: `
    <b>{{ label }}</b>
  `,
})
class BadgeComponent {
  readonly label = "badge";
}

@Component({
  imports: [CopilotA2UISurface],
  template: `
    <copilot-a2ui-surface
      [catalog]="catalog"
      [operations]="operations()"
      (action)="actions.push($event)"
    />
  `,
})
class HostComponent {
  readonly catalog = basicCatalog;
  readonly operations = signal<unknown[]>([]);
  readonly actions: A2UIClientEventMessage[] = [];
}

function surface(components: unknown[], data?: unknown): unknown[] {
  return [
    { updateComponents: { surfaceId: "default", components } },
    ...(data === undefined
      ? []
      : [
          { updateDataModel: { surfaceId: "default", path: "/", value: data } },
        ]),
  ];
}

async function render(
  operations: unknown[],
): Promise<{ fixture: ComponentFixture<HostComponent>; element: HTMLElement }> {
  TestBed.resetTestingModule();
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.operations.set(operations);
  await settle(fixture);
  return { fixture, element: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<HostComponent>) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event("input"));
}

describe("basicCatalog", () => {
  it("matches the Lit basic catalog's id, components, schemas, and functions", () => {
    expect(basicCatalog.id).toBe(litBasicCatalog.id);
    expect([...basicCatalog.components.keys()]).toEqual([
      ...litBasicCatalog.components.keys(),
    ]);
    for (const [name, component] of basicCatalog.components) {
      expect(component.schema).toBe(
        litBasicCatalog.components.get(name)?.schema,
      );
    }
    expect([...basicCatalog.functions.keys()]).toEqual([
      ...litBasicCatalog.functions.keys(),
    ]);
  });

  it("can be extended, with definitions replacing basic components by name", () => {
    const catalog = createAngularCatalog(
      {
        Badge: { props: z.object({}) },
        Text: { props: z.object({ text: z.string() }) },
      },
      { Badge: BadgeComponent, Text: BadgeComponent },
      { catalogId: "copilotkit://extended", includeBasicCatalog: true },
    );

    expect(catalog.components.size).toBe(basicCatalog.components.size + 1);
    expect(catalog.components.get("Row")?.component).toBe(
      basicCatalog.components.get("Row")?.component,
    );
    expect(catalog.components.get("Text")?.component).toBe(BadgeComponent);
    expect(basicCatalog.components.get("Text")?.component).toBe(
      CopilotA2UIText,
    );
    expect(buildCatalogContextValue(catalog)).toContain(
      "Extends the basic catalog",
    );
  });
});

describe("basic catalog components", () => {
  it("renders layout and content like the Lit catalog", async () => {
    const { element } = await render(
      surface([
        {
          id: "root",
          component: "Column",
          justify: "center",
          children: ["title", "row", "card", "list", "divider"],
        },
        { id: "title", component: "Text", text: "Hello", variant: "h1" },
        {
          id: "row",
          component: "Row",
          justify: "spaceBetween",
          align: "center",
          children: ["avatar", "icon"],
        },
        {
          id: "avatar",
          component: "Image",
          url: "https://example.com/a.png",
          variant: "avatar",
          fit: "scaleDown",
        },
        { id: "icon", component: "Icon", name: "home" },
        { id: "card", component: "Card", child: "caption" },
        { id: "caption", component: "Text", text: "Note", variant: "caption" },
        {
          id: "list",
          component: "List",
          direction: "horizontal",
          children: { componentId: "item", path: "/items" },
        },
        { id: "item", component: "Text", text: { path: "name" } },
        { id: "divider", component: "Divider", axis: "vertical" },
      ]).concat(
        surface([], { items: [{ name: "One" }, { name: "Two" }] }).slice(1),
      ),
    );

    const column = element.querySelector<HTMLElement>(".column");
    expect(column?.style.justifyContent).toBe("center");
    expect(column?.querySelector("h1")?.textContent?.trim()).toBe("Hello");

    const row = element.querySelector<HTMLElement>(".row");
    expect(row?.style.justifyContent).toBe("space-between");
    expect(row?.style.alignItems).toBe("center");

    const image = row?.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/a.png");
    expect(image?.classList).toContain("variant-avatar");
    expect(image?.style.objectFit).toBe("scale-down");
    expect(row?.querySelector(".material-symbols-outlined")?.textContent).toBe(
      "home",
    );

    expect(
      element.querySelector(".card small.caption")?.textContent?.trim(),
    ).toBe("Note");
    expect(
      [...element.querySelectorAll(".list.horizontal span")].map((span) =>
        span.textContent?.trim(),
      ),
    ).toEqual(["One", "Two"]);
    expect(element.querySelector(".divider.vertical")).not.toBeNull();
  });

  it("dispatches button actions and disables buttons that fail their checks", async () => {
    const { fixture, element } = await render(
      surface(
        [
          { id: "root", component: "Row", children: ["submit", "blocked"] },
          {
            id: "submit",
            component: "Button",
            child: "submit-label",
            variant: "primary",
            action: { event: { name: "submit", context: {} } },
          },
          { id: "submit-label", component: "Text", text: "Submit" },
          {
            id: "blocked",
            component: "Button",
            child: "blocked-label",
            action: { event: { name: "blocked", context: {} } },
            checks: [{ condition: { path: "/ready" }, message: "Not yet" }],
          },
          { id: "blocked-label", component: "Text", text: "Blocked" },
        ],
        { ready: false },
      ),
    );

    const [submit, blocked] = element.querySelectorAll("button");
    expect(submit?.classList).toContain("primary");
    expect(submit?.textContent?.trim()).toBe("Submit");
    expect(blocked?.disabled).toBe(true);

    submit?.click();
    await settle(fixture);
    expect(fixture.componentInstance.actions).toEqual([
      {
        userAction: expect.objectContaining({
          name: "submit",
          sourceComponentId: "submit",
        }),
      },
    ]);
  });

  it("writes inputs back into the data model", async () => {
    const { fixture, element } = await render(
      surface(
        [
          {
            id: "root",
            component: "Column",
            children: [
              "name",
              "echo",
              "agree",
              "volume",
              "date",
              "size",
              "tags",
              "send",
            ],
          },
          {
            id: "name",
            component: "TextField",
            label: "Name",
            value: { path: "/name" },
            checks: [{ condition: { path: "/valid" }, message: "Required" }],
          },
          { id: "echo", component: "Text", text: { path: "/name" } },
          {
            id: "agree",
            component: "CheckBox",
            label: "Agree",
            value: { path: "/agree" },
          },
          {
            id: "volume",
            component: "Slider",
            label: "Volume",
            max: 10,
            value: { path: "/volume" },
          },
          {
            id: "date",
            component: "DateTimeInput",
            enableDate: true,
            value: { path: "/date" },
          },
          {
            id: "size",
            component: "ChoicePicker",
            variant: "mutuallyExclusive",
            options: [
              { label: "Small", value: "s" },
              { label: "Large", value: "l" },
            ],
            value: { path: "/size" },
          },
          {
            id: "tags",
            component: "ChoicePicker",
            variant: "multipleSelection",
            displayStyle: "chips",
            filterable: true,
            options: [
              { label: "Red", value: "red" },
              { label: "Blue", value: "blue" },
            ],
            value: { path: "/tags" },
          },
          {
            id: "send",
            component: "Button",
            child: "send-label",
            action: {
              event: {
                name: "send",
                context: {
                  name: { path: "/name" },
                  agree: { path: "/agree" },
                  volume: { path: "/volume" },
                  size: { path: "/size" },
                  tags: { path: "/tags" },
                },
              },
            },
          },
          { id: "send-label", component: "Text", text: "Send" },
        ],
        {
          name: "Ada",
          valid: false,
          agree: false,
          volume: 3,
          date: "",
          size: [],
          tags: [],
        },
      ),
    );

    const name = element.querySelector<HTMLInputElement>(".field input")!;
    expect(name.value).toBe("Ada");
    expect(
      element.querySelector<HTMLLabelElement>(`label[for="${name.id}"]`)
        ?.textContent,
    ).toBe("Name");
    expect(element.querySelector(".error")?.textContent).toBe("Required");
    type(name, "Grace");
    await settle(fixture);
    expect(
      [...element.querySelectorAll("span.text")].map((span) =>
        span.textContent?.trim(),
      ),
    ).toContain("Grace");

    const agree = element.querySelector<HTMLInputElement>(
      'input[type="checkbox"].checkbox',
    )!;
    agree.checked = true;
    agree.dispatchEvent(new Event("change"));

    const volume = element.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;
    expect(volume.max).toBe("10");
    type(volume, "7");

    expect(element.querySelector('input[type="date"]')).not.toBeNull();

    const [, large] = element.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    large!.checked = true;
    large!.dispatchEvent(new Event("change"));

    const filter = element.querySelector<HTMLInputElement>(".filter")!;
    type(filter, "bl");
    await settle(fixture);
    const chips = element.querySelectorAll<HTMLButtonElement>(".chip");
    expect([...chips].map((chip) => chip.textContent?.trim())).toEqual([
      "Blue",
    ]);
    chips[0]!.click();
    await settle(fixture);

    expect(element.querySelector(".value")?.textContent).toBe("7");
    expect(element.querySelector(".chip")?.classList).toContain("selected");

    [...element.querySelectorAll("button")].at(-1)?.click();
    await settle(fixture);
    expect(
      fixture.componentInstance.actions.at(-1)?.userAction?.context,
    ).toEqual({
      name: "Grace",
      agree: true,
      volume: 7,
      size: ["l"],
      tags: ["blue"],
    });
  });

  it("shows falsy values such as 0 in text fields", async () => {
    const { element } = await render(
      surface(
        [
          {
            id: "root",
            component: "TextField",
            variant: "number",
            value: { path: "/count" },
          },
        ],
        { count: 0 },
      ),
    );

    expect(element.querySelector<HTMLInputElement>("input")?.value).toBe("0");
  });

  it("switches tabs and opens and closes modals", async () => {
    const { fixture, element } = await render(
      surface([
        { id: "root", component: "Column", children: ["tabs", "modal"] },
        {
          id: "tabs",
          component: "Tabs",
          tabs: [
            { title: "First", child: "first" },
            { title: "Second", child: "second" },
          ],
        },
        { id: "first", component: "Text", text: "First panel" },
        { id: "second", component: "Text", text: "Second panel" },
        {
          id: "modal",
          component: "Modal",
          trigger: "open",
          content: "details",
        },
        { id: "open", component: "Text", text: "Open" },
        { id: "details", component: "Text", text: "Details" },
      ]),
    );

    const panel = () =>
      element.querySelector(".tab-panel")?.textContent?.trim();
    expect(panel()).toBe("First panel");
    const tabs = element.querySelectorAll<HTMLButtonElement>(".tab");
    expect(tabs[0]?.classList).toContain("active");
    tabs[1]?.click();
    await settle(fixture);
    expect(panel()).toBe("Second panel");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");

    expect(element.querySelector('[role="dialog"]')).toBeNull();
    element.querySelector<HTMLElement>(".trigger")?.click();
    await settle(fixture);
    expect(element.querySelector('[role="dialog"]')?.textContent).toContain(
      "Details",
    );
    element.querySelector<HTMLElement>(".backdrop")?.click();
    await settle(fixture);
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });
});
