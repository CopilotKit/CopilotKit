import { html } from "lit";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CPK_A2UI_SURFACE_TAG, defineA2UIWebComponents } from "../define";
import {
  createA2UICatalog,
  createCatalog,
  extractA2UISchema,
  extractSchema,
} from "../create-catalog";
import type { A2UIComponentMap } from "../create-catalog";
import { basicCatalog, fullCatalog } from "../catalog/basic";
import { minimalCatalog } from "../catalog/minimal";
import type { A2UISurfaceElement, RendererProps } from "../types";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";
const BASIC_COMPONENT_NAMES = [
  "Text",
  "Image",
  "Icon",
  "Video",
  "AudioPlayer",
  "Row",
  "Column",
  "List",
  "Card",
  "Tabs",
  "Divider",
  "Modal",
  "Button",
  "TextField",
  "CheckBox",
  "ChoicePicker",
  "Slider",
  "DateTimeInput",
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitForRender(element: Element) {
  await (element as any).updateComplete;
  await tick();
  await tick();
}

function textSurfaceOperations(text = "Hello from A2UI") {
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId: "surface",
        catalogId: BASIC_CATALOG_ID,
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "surface",
        components: [
          {
            id: "root",
            component: "Text",
            text,
          },
        ],
      },
    },
  ];
}

function buttonSurfaceOperations() {
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId: "surface",
        catalogId: BASIC_CATALOG_ID,
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "surface",
        components: [
          {
            id: "root",
            component: "Button",
            child: "label",
            action: { event: { name: "confirm" } },
            variant: "primary",
          },
          {
            id: "label",
            component: "Text",
            text: "Confirm",
          },
        ],
      },
    },
  ];
}

function createSurfaceElement(): A2UISurfaceElement {
  defineA2UIWebComponents();
  const element = document.createElement(
    CPK_A2UI_SURFACE_TAG,
  ) as A2UISurfaceElement;
  document.body.appendChild(element);
  return element;
}

describe("A2UI Lit Web Components", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("registers elements idempotently", () => {
    defineA2UIWebComponents();
    const first = customElements.get(CPK_A2UI_SURFACE_TAG);
    defineA2UIWebComponents();
    expect(customElements.get(CPK_A2UI_SURFACE_TAG)).toBe(first);
  });

  it("renders a basic A2UI surface from the operations property", async () => {
    const element = createSurfaceElement();
    element.operations = textSurfaceOperations();

    await waitForRender(element);

    expect(element.textContent).toContain("Hello from A2UI");
  });

  it("normalizes legacy v0.8 surface messages", async () => {
    const element = createSurfaceElement();
    element.operations = [
      {
        beginRendering: {
          surfaceId: "legacy-surface",
          styles: {},
        },
      },
      {
        surfaceUpdate: {
          surfaceId: "legacy-surface",
          components: [
            {
              id: "root",
              component: {
                Text: {
                  text: "Legacy surface",
                },
              },
            },
          ],
        },
      },
    ];

    await waitForRender(element);

    expect(element.textContent).toContain("Legacy surface");
    expect(
      element.querySelector('[data-surface-id="legacy-surface"]'),
    ).toBeTruthy();
  });

  it("falls back to the default surface for invalid surface ids", async () => {
    const element = createSurfaceElement();
    element.operations = [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: 123,
          catalogId: BASIC_CATALOG_ID,
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: null,
          components: [
            {
              id: "root",
              component: "Text",
              text: "Default surface",
            },
          ],
        },
      },
    ];

    await waitForRender(element);

    expect(element.textContent).toContain("Default surface");
    expect(element.querySelector('[data-surface-id="default"]')).toBeTruthy();
  });

  it("exports minimal, basic, and full catalogs", () => {
    expect(minimalCatalog.components.has("Text")).toBe(true);
    expect(minimalCatalog.components.has("TextField")).toBe(true);
    expect(minimalCatalog.components.has("Slider")).toBe(false);
    expect([...basicCatalog.components.keys()]).toEqual(BASIC_COMPONENT_NAMES);
    expect([...fullCatalog.components.keys()]).toEqual(BASIC_COMPONENT_NAMES);
    expect(fullCatalog).toBe(basicCatalog);
  });

  it("ignores duplicate createSurface snapshots for an existing surface", async () => {
    const element = createSurfaceElement();
    element.operations = textSurfaceOperations("First");
    await waitForRender(element);

    element.operations = textSurfaceOperations("Second");
    await waitForRender(element);

    expect(element.textContent).toContain("Second");
  });

  it("dispatches a2ui-action from Button", async () => {
    const element = createSurfaceElement();
    const onAction = vi.fn();
    element.addEventListener("a2ui-action", onAction);
    element.operations = buttonSurfaceOperations();

    await waitForRender(element);
    element.querySelector("button")?.click();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0].detail).toMatchObject({
      userAction: {
        name: "confirm",
        surfaceId: "surface",
        sourceComponentId: "root",
      },
    });
  });

  it("emits a2ui-error and renders the error UI", async () => {
    const element = createSurfaceElement();
    const onError = vi.fn();
    element.addEventListener("a2ui-error", onError);
    element.operations = [
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "surface",
          components: [{ component: "Text" }],
        },
      },
    ];

    await waitForRender(element);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain("A2UI render error:");
  });

  it("supports createCatalog custom Lit renderers", async () => {
    const catalog = createCatalog(
      {
        Badge: {
          props: z.object({
            label: z.string(),
            child: z.string().optional(),
          }),
        },
      },
      {
        Badge: ({ props, children, dispatch }) => html`
          <button @click=${() => dispatch?.({ event: { name: "badge" } })}>
            ${props.label}${props.child ? children(props.child) : null}
          </button>
        `,
      },
      { catalogId: "test-catalog", includeBasicCatalog: true },
    );

    const element = createSurfaceElement();
    const onAction = vi.fn();
    element.catalog = catalog;
    element.addEventListener("a2ui-action", onAction);
    element.operations = [
      {
        version: "v0.9",
        createSurface: { surfaceId: "surface", catalogId: "test-catalog" },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "surface",
          components: [
            {
              id: "root",
              component: "Badge",
              label: "Badge",
              child: "label",
            },
            {
              id: "label",
              component: "Text",
              text: " child",
            },
          ],
        },
      },
    ];

    await waitForRender(element);
    expect(element.textContent).toContain("Badge");
    expect(element.textContent).toContain("child");

    element.querySelector("button")?.click();
    expect(onAction.mock.calls[0]?.[0].detail).toMatchObject({
      userAction: { name: "badge" },
    });
  });

  it("keeps deprecated catalog aliases aligned", () => {
    const components = {
      Badge: {
        props: z.object({ label: z.string() }),
        render: ({ props }: RendererProps<{ label: string }>) => props.label,
      },
    } satisfies A2UIComponentMap;

    expect(createA2UICatalog(components).id).toBe(
      createCatalog(
        { Badge: { props: components.Badge.props } },
        { Badge: components.Badge.render as any },
      ).id,
    );
    expect(extractA2UISchema(components)).toEqual(
      extractSchema({ Badge: { props: components.Badge.props } }),
    );
  });
});
