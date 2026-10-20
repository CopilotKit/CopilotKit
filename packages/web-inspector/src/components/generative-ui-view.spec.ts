import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ɵGenerativeUIDebugSnapshot,
  ɵGenerativeUIDebugSource,
} from "@copilotkit/core";
import type { CpkGenerativeUIView } from "./generative-ui-view.js";
import {
  componentTree,
  estimateTokens,
  functionHandlerProblem,
  groupByCatalog,
  operationKind,
} from "./generative-ui-view.js";

const envelope = {
  "v1.0": { supportedCatalogIds: ["shop@1"] },
  metadata: {
    extensions: {
      copilotkit_format: 3,
      copilotkit_transport: "tool",
      copilotkit_targets: [],
      copilotkit_surfaces: {},
      copilotkit_contextSent: false,
    },
  },
} as unknown as ɵGenerativeUIDebugSnapshot["nextRun"]["envelope"];

function snapshot(): ɵGenerativeUIDebugSnapshot {
  return {
    catalogId: "shop@1",
    transport: "tool",
    components: {
      ProductCard: {
        description: "One product",
        props: { type: "object" },
        events: { onAdd: { parameters: { type: "object" } } },
      },
    },
    componentCatalogs: { ProductCard: "shop@1" },
    functions: {
      addToCart: { parameters: { type: "object" }, handlers: 0 },
    },
    state: { cart: { items: [] } },
    targets: [
      { id: "chat", kind: "chat" },
      { id: "featured", kind: "inline" },
    ],
    activeThreadId: "t1",
    surfaces: [
      {
        surfaceId: "cart-view",
        threadId: "t1",
        agentId: "default",
        target: "chat",
        status: "ready",
        operations: [
          {
            version: "v1.0",
            createSurface: {
              surfaceId: "cart-view",
              components: [
                { id: "root", component: "ProductCard", name: "Shoe" },
              ],
            },
          },
        ] as ɵGenerativeUIDebugSnapshot["surfaces"][number]["operations"],
        dataModel: { total: 3 },
        userValues: { "/email": "a@b.c" },
        rejected: [
          { index: 2, reason: "unknown component", source: "runtime" },
        ],
      },
    ],
    lastRun: undefined,
    nextRun: {
      agentId: undefined,
      threadId: "t1",
      envelope,
      prompt: [
        {
          title: "render_ui guide",
          source: "runtime",
          text: "## Generative UI",
        },
      ],
    },
  };
}

function fakeSource(current = snapshot()) {
  const listeners = new Set<() => void>();
  const source: ɵGenerativeUIDebugSource = {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { source, listeners };
}

async function mount(source: ɵGenerativeUIDebugSource | undefined) {
  const view = document.createElement(
    "cpk-generative-ui-view",
  ) as CpkGenerativeUIView;
  view.source = source;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

async function openTab(view: CpkGenerativeUIView, label: string) {
  const tab = [
    ...view.shadowRoot!.querySelectorAll<HTMLButtonElement>(".tab"),
  ].find((button) => button.textContent?.trim() === label);
  tab!.click();
  await view.updateComplete;
}

const text = (view: CpkGenerativeUIView) =>
  view.shadowRoot!.textContent?.replace(/\s+/g, " ") ?? "";

afterEach(() => {
  document.body.replaceChildren();
});

describe("generative UI view helpers", () => {
  it("names the kind of an operation", () => {
    expect(operationKind({ version: "v1.0", updateComponents: {} })).toBe(
      "updateComponents",
    );
    expect(operationKind(null)).toBe("unknown");
  });

  it("flags a function without exactly one handler", () => {
    expect(functionHandlerProblem(1)).toBeUndefined();
    expect(functionHandlerProblem(0)).toMatch(/No useGenerativeUIFunction/);
    expect(functionHandlerProblem(2)).toMatch(/2 handlers/);
  });

  it("builds the component tree from the slots, with the last write of each id", () => {
    const catalog = {
      Grid: { props: {}, slots: { children: "multiple" as const } },
      List: { props: {}, slots: { item: "multiple" as const } },
      Card: { props: {} },
    };
    const operations = [
      {
        version: "v1.0",
        createSurface: {
          surfaceId: "s1",
          components: [
            {
              id: "root",
              component: "Grid",
              gap: 2,
              children: ["a", "b", "late"],
            },
            { id: "a", component: "Card", title: "Old" },
          ],
        },
      },
      {
        version: "v1.0",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "a", component: "Card", title: "New" },
            {
              id: "b",
              component: "List",
              item: { componentId: "row", path: "/items" },
            },
            { id: "row", component: "Card", title: { path: "name" } },
          ],
        },
      },
      {
        version: "v1.0",
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "late", component: "Card" }],
        },
      },
    ] as Parameters<typeof componentTree>[0];

    // Operation 2 is rejected, so "late" is not rendered.
    expect(componentTree(operations, new Set([2]), catalog)).toEqual({
      id: "root",
      component: "Grid",
      props: { gap: 2 },
      children: [
        { id: "a", component: "Card", props: { title: "New" }, children: [] },
        {
          id: "b",
          component: "List",
          props: {},
          children: [
            {
              id: "row",
              component: "Card",
              props: { title: { path: "name" } },
              repeat: "/items",
              children: [],
            },
          ],
        },
      ],
    });
    expect(componentTree([], new Set(), catalog)).toBeUndefined();
  });

  it("groups components by catalog, the provider catalog first", () => {
    const entries: [string, number][] = [
      ["Text", 1],
      ["ProductCard", 2],
      ["Button", 3],
    ];
    expect(
      groupByCatalog(entries, {
        catalogId: "shop@1",
        componentCatalogs: {
          Text: "standard@1",
          ProductCard: "shop@1",
          Button: "standard@1",
        },
      }),
    ).toEqual([
      ["shop@1", [["ProductCard", 2]]],
      [
        "standard@1",
        [
          ["Text", 1],
          ["Button", 3],
        ],
      ],
    ]);
  });

  it("estimates about four characters for each token", () => {
    expect(estimateTokens("12345678")).toBe(2);
  });
});

describe("cpk-generative-ui-view", () => {
  it("explains how to turn generative UI on when there is no source", async () => {
    const view = await mount(undefined);
    expect(text(view)).toContain("No generative UI");
  });

  it("shows targets, surfaces with their rejections, and app state", async () => {
    const view = await mount(fakeSource().source);

    expect(text(view)).toContain("shop@1");
    expect(text(view)).toContain("tool transport");
    // An inline target with no description gets a warning.
    expect(text(view)).toContain("No description.");
    expect(text(view)).toContain("cart-view");
    expect(text(view)).toContain("1 rejected");

    view.shadowRoot!.querySelector<HTMLButtonElement>(".card-toggle")!.click();
    await view.updateComplete;
    expect(text(view)).toContain("operation 2: unknown component");
    expect(text(view)).toContain('"/email": "a@b.c"');
    // The rendered components, with the props behind a toggle.
    expect(text(view)).toContain("ProductCard root 1 props");
    view
      .shadowRoot!.querySelector<HTMLButtonElement>(".tree .op-toggle")!
      .click();
    await view.updateComplete;
    expect(text(view)).toContain('"name": "Shoe"');
    // JSON goes through the inspector JSON block, with its token colors.
    expect(
      view.shadowRoot!.querySelector(".cpk-json-block .cpk-json-token--key"),
    ).not.toBeNull();
  });

  it("outlines and scrolls to a page surface while its card is hovered", async () => {
    const current = snapshot();
    const inline = {
      ...current.surfaces[0]!,
      surfaceId: "hero",
      target: "featured",
    };
    current.surfaces = [current.surfaces[0]!, inline];
    // As on the page: the root has `display: contents`, so the box is the
    // `<GenerativeUISurface>` element around it. A chat root has none.
    const root = (id: string) => {
      const element = document.createElement("div");
      element.setAttribute("data-generative-ui-root", id);
      element.scrollIntoView = vi.fn();
      return element;
    };
    const chat = root("cart-view");
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-generative-ui-surface", "featured");
    wrapper.scrollIntoView = vi.fn();
    wrapper.append(root("hero"));
    document.body.append(chat, wrapper);
    const view = await mount(fakeSource(current).source);
    const [chatCard, heroCard] = view.shadowRoot!.querySelectorAll(".card");

    heroCard!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(wrapper.style.outline).toContain("solid");
    expect(wrapper.scrollIntoView).toHaveBeenCalled();
    heroCard!.dispatchEvent(new MouseEvent("mouseleave"));
    expect(wrapper.style.outline).toBe("");

    // A chat surface is left alone, so the chat does not scroll.
    chatCard!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(chat.style.outline).toBe("");
    expect(chat.scrollIntoView).not.toHaveBeenCalled();
  });

  it("shows the catalog and warns about a function with no handler", async () => {
    const view = await mount(fakeSource().source);
    await openTab(view, "Catalog");

    expect(text(view)).toContain("shop@1 1 components");
    expect(text(view)).toContain("ProductCard");
    expect(text(view)).toContain("onAdd");
    expect(text(view)).toContain("0 handlers");
    expect(text(view)).toContain("the model does not get this function");
  });

  it("collapses a base catalog, and the search opens it and filters", async () => {
    const current = snapshot();
    current.components.Text = { description: "Plain text", props: {} };
    current.componentCatalogs.Text = "standard@1";
    const view = await mount(fakeSource(current).source);
    await openTab(view, "Catalog");
    const toggle = (id: string) =>
      [
        ...view.shadowRoot!.querySelectorAll<HTMLButtonElement>(
          ".catalog-toggle",
        ),
      ].find((button) => button.textContent?.includes(id))!;

    // The provider catalog starts open. The base catalog starts closed.
    expect(toggle("shop@1").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("standard@1").getAttribute("aria-expanded")).toBe("false");
    expect(text(view)).not.toContain("Plain text");
    toggle("standard@1").click();
    await view.updateComplete;
    expect(text(view)).toContain("Plain text");
    toggle("shop@1").click();
    await view.updateComplete;
    expect(text(view)).not.toContain("One product");

    toggle("standard@1").click();
    const search = view.shadowRoot!.querySelector<HTMLInputElement>(".filter")!;
    search.value = "plain";
    search.dispatchEvent(new Event("input"));
    await view.updateComplete;
    expect(text(view)).toContain("Plain text");
    expect(text(view)).not.toContain("ProductCard");
    expect(text(view)).toContain("No function matches.");
  });

  it("shows the next run when no run happened yet", async () => {
    const view = await mount(fakeSource().source);
    await openTab(view, "Prompt");

    expect(text(view)).toContain("What the next run will send");
    expect(text(view)).toContain("forwardedProps.copilotkit.ui");
    // The large text is drawn only when it is open.
    expect(text(view)).not.toContain("## Generative UI");
    expect(view.shadowRoot!.querySelector(".cpk-json-block")).toBeNull();

    const show = [
      ...view.shadowRoot!.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((button) => button.textContent?.trim() === "Show");
    for (const button of show) button.click();
    await view.updateComplete;
    expect(text(view)).toContain("## Generative UI");
    expect(view.shadowRoot!.querySelector(".cpk-json-block")).not.toBeNull();
  });

  it("renders again when the source changes, and unsubscribes on removal", async () => {
    const { source, listeners } = fakeSource();
    const view = await mount(source);
    expect(listeners.size).toBe(1);
    const update = vi.spyOn(view, "requestUpdate");

    for (const listener of listeners) listener();
    expect(update).toHaveBeenCalled();

    view.remove();
    expect(listeners.size).toBe(0);
  });
});
