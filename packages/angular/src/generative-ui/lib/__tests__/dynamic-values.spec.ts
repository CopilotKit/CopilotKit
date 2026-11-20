import { Component, input } from "@angular/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGenerativeUIDispatcher } from "@copilotkit/core/generative-ui";
import type { GenerativeUIInvokeResult } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIChildren } from "../children";
import { CopilotGenerativeUIChildren } from "../children.directive";
import { injectGenerativeUIAccessibility } from "../node-context";
import { renderSurface, updateComponents, updateDataModel } from "./render";

type Handler = (args?: unknown) => Promise<GenerativeUIInvokeResult>;

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
  selector: "test-rows",
  template: `
    <dl>
      @for (row of rows(); track row.label) {
        <div [attr.data-row]="row.label">{{ row.label }}: {{ row.value }}</div>
      }
    </dl>
  `,
})
class Rows {
  readonly rows = input<Array<{ label: string; value: unknown }>>();
}

@Component({
  selector: "test-button",
  template: `
    <button type="button" (click)="onClick()?.({})">{{ label() }}</button>
  `,
})
class Button {
  readonly label = input<string>();
  readonly onClick = input<Handler>();
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
  selector: "test-panel",
  template: `
    <section
      data-panel
      [attr.aria-label]="aria()['aria-label'] ?? null"
      [attr.aria-description]="aria()['aria-description'] ?? null"
      [attr.aria-live]="aria()['aria-live'] ?? null"
      [attr.aria-hidden]="aria()['aria-hidden'] ?? null"
    >
      {{ title() }}
    </section>
  `,
})
class Panel {
  readonly title = input<string>();
  protected readonly aria = injectGenerativeUIAccessibility();
}

const ui = createGenerativeUI({
  id: "test",
  components: {
    Column: { component: Column, slots: { children: "multiple" } },
    Text: {
      component: Text,
      props: z.object({ text: z.union([z.string(), z.number()]) }),
    },
    Rows: {
      component: Rows,
      props: z.object({
        rows: z.array(z.object({ label: z.string(), value: z.unknown() })),
      }),
    },
    Button: {
      component: Button,
      props: z.object({ label: z.string() }),
      events: { onClick: { parameters: z.object({}) } },
    },
    // Strict: an envelope key that reached the props would fail it.
    Panel: {
      component: Panel,
      props: z.object({ title: z.string() }).strict(),
    },
  },
});

const text = (container: HTMLElement) =>
  container.querySelector("[data-text]")?.textContent?.trim();
const texts = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-text]")].map((el) =>
    el.textContent?.trim(),
  );
const row = (container: HTMLElement, label: string) =>
  container.querySelector(`[data-row="${label}"]`)?.textContent?.trim();
const button = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>("button")!;
const panel = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-panel]")!;

describe("dynamic values in props", () => {
  it("resolves a binding nested in a list prop and updates when the data changes", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Rows",
          rows: [
            { label: "Price", value: { "@path": "/price" } },
            { label: "Fixed", value: 1 },
          ],
        },
      ],
      { price: 10 },
    );
    expect(row(view.container, "Price")).toBe("Price: 10");
    view.update(updateDataModel("/price", 12));
    expect(row(view.container, "Price")).toBe("Price: 12");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("computes a function value from bound data and recomputes on change", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Text",
          text: {
            "@call": "formatString",
            args: {
              value:
                "${/qty} × ${formatCurrency(value: /price, currency: 'EUR')}",
            },
          },
        },
      ],
      { qty: 2, price: 1599 },
    );
    expect(text(view.container)).toBe("2 × €1,599.00");
    view.update(updateDataModel("/qty", 3));
    expect(text(view.container)).toBe("3 × €1,599.00");
  });

  it("falls back and reports when a function value cannot be computed", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Text",
        text: { "@call": "formatNumber", args: { value: "many" } },
      },
    ]);
    expect(view.reportError).toHaveBeenCalled();
    const error = view.reportError.mock.calls[0]![0];
    expect(error.kind).toBe("props");
    expect(error.error.message).toContain("text: value must be a number");
    expect(view.container.querySelector("[data-text]")).toBeNull();
  });

  it("recomputes a series when the data it reads changes", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Rows",
          rows: {
            "@call": "series",
            args: {
              count: 2,
              variable: "m",
              item: { label: "M${m}", value: "${m * seats * 29}" },
              seats: { "@path": "/seats" },
            },
          },
        },
      ],
      { seats: 2 },
    );
    expect(row(view.container, "M2")).toBe("M2: 116");
    view.update(updateDataModel("/seats", 3));
    expect(row(view.container, "M2")).toBe("M2: 174");
  });

  it("keeps a bound object that has a valid field, and coerces a validator result inside calc", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Rows",
          rows: [
            { label: "Profile", value: { "@path": "/profile" } },
            {
              label: "Score",
              value: {
                "@call": "calc",
                args: {
                  expression: "ok ? 1 : 0",
                  ok: { "@call": "required", args: { value: "x" } },
                },
              },
            },
          ],
        },
      ],
      { profile: { valid: true, name: "Ada" } },
    );
    expect(row(view.container, "Profile")).toBe("Profile: [object Object]");
    expect(row(view.container, "Score")).toBe("Score: 1");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("recovers once the data that a failed function value read arrives", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Text",
          text: {
            "@call": "formatNumber",
            args: { value: { "@path": "/price" } },
          },
        },
      ],
      { price: "" },
    );
    expect(view.reportError).toHaveBeenCalled();
    expect(view.container.querySelector("[data-text]")).toBeNull();
    view.update(updateDataModel("/price", 1234));
    expect(text(view.container)).toBe("1,234");
  });

  it("recomputes a value that read a list when an item of the list changes", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Text",
          text: {
            "@call": "formatString",
            args: { value: "${and(values: /flags)}" },
          },
        },
      ],
      { flags: [true, true] },
    );
    expect(text(view.container)).toBe("true");
    view.update(updateDataModel("/flags/0", false));
    expect(text(view.container)).toBe("false");
  });

  it("resolves a template row again when the template moves to another list", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Column",
          children: { componentId: "row", path: "/a" },
        },
        { id: "row", component: "Text", text: { "@path": "name" } },
      ],
      { a: [{ name: "from a" }], b: [{ name: "from b" }] },
    );
    expect(text(view.container)).toBe("from a");
    view.update(
      updateComponents({
        id: "root",
        component: "Column",
        children: { componentId: "row", path: "/b" },
      }),
    );
    expect(text(view.container)).toBe("from b");
  });

  it("gives @index to a template item inside a function value", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Column",
          children: { componentId: "row", path: "/items" },
        },
        {
          id: "row",
          component: "Text",
          text: {
            "@call": "formatString",
            args: { value: "${@index(offset: 1)}. ${label}" },
          },
        },
      ],
      { items: [{ label: "a" }, { label: "b" }] },
    );
    expect(texts(view.container)).toEqual(["1. a", "2. b"]);
  });
});

describe("dynamic values in event bindings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a URL from a functionCall binding, as a user gesture", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Button",
        label: "Docs",
        onClick: {
          functionCall: {
            "@call": "openUrl",
            args: { url: "https://example.com/docs" },
          },
        },
      },
    ]);
    button(view.container).click();
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://example.com/docs",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    expect(view.forwardEvent).not.toHaveBeenCalled();
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("resolves a context whose only key is named like an action binding", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Button",
          label: "Go",
          onClick: {
            event: { name: "go", context: { event: { "@path": "/picked" } } },
          },
        },
      ],
      { picked: "launch" },
    );
    button(view.container).click();
    await vi.waitFor(() => expect(view.forwardEvent).toHaveBeenCalled());
    expect(view.forwardEvent.mock.calls[0]![0].context).toEqual({
      event: "launch",
    });
  });

  it("resolves function values in the userMessage and the context of an event", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Button",
          label: "Buy",
          onClick: {
            event: {
              name: "buy",
              userMessage: {
                "@call": "formatString",
                args: { value: "Buy ${/qty} for ${/name}" },
              },
              context: {
                total: {
                  "@call": "formatCurrency",
                  args: { value: { "@path": "/price" }, currency: "USD" },
                },
                nested: { qty: { "@path": "/qty" } },
              },
            },
          },
        },
      ],
      { qty: 2, name: "Ada", price: 5 },
    );
    button(view.container).click();
    await vi.waitFor(() => expect(view.forwardEvent).toHaveBeenCalled());
    const [event] = view.forwardEvent.mock.calls[0]!;
    expect(event.userMessage).toBe("Buy 2 for Ada");
    expect(event.context).toEqual({ total: "$5.00", nested: { qty: 2 } });
  });
});

describe("basic functions through the dispatcher", () => {
  const dispatcher = createGenerativeUIDispatcher({
    getDeclared: () => ui.functions,
  });

  const component = { surfaceId: "s", componentId: "c" };

  it("runs a basic function for a component, and refuses the agent: they are value functions of the UI", async () => {
    await expect(
      dispatcher.invoke("formatNumber", { value: 1234 }, component),
    ).resolves.toEqual({ ok: true, result: "1,234" });
    for (const [name, args] of [
      ["formatNumber", { value: 1234 }],
      ["openUrl", { url: "https://x" }],
    ] as const) {
      const refused = await dispatcher.invoke(name, args, {
        functionCallId: "f2",
      });
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("invalid_function_call");
      }
    }
  });

  it("refuses openUrl when the browser reports no user activation", async () => {
    const original = Object.getOwnPropertyDescriptor(
      navigator,
      "userActivation",
    );
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: false, hasBeenActive: true },
    });
    try {
      const result = await dispatcher.invoke(
        "openUrl",
        { url: "https://x" },
        { surfaceId: "s", componentId: "c" },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("not one");
    } finally {
      if (original) {
        Object.defineProperty(navigator, "userActivation", original);
      } else {
        delete (navigator as { userActivation?: unknown }).userActivation;
      }
    }
  });

  it("does not run a basic function in place of a declared app function whose handler is not mounted", async () => {
    const declared = createGenerativeUIDispatcher({
      getDeclared: () =>
        new Map([
          ["formatNumber", { parameters: z.object({ value: z.number() }) }],
        ]),
    });
    const result = await declared.invoke(
      "formatNumber",
      { value: 1 },
      { functionCallId: "f6" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("function_not_found");
  });

  it("returns invalid_arguments for bad args and function_not_found for other names", async () => {
    const bad = await dispatcher.invoke(
      "formatCurrency",
      { value: 1 },
      component,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("invalid_arguments");
    const missing = await dispatcher.invoke(
      "nope",
      {},
      { functionCallId: "f4" },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("function_not_found");
  });
});

describe("the component envelope", () => {
  it("resolves accessibility, gives it to the component as ARIA attributes, and keeps catalogId and metadata out of the props", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Panel",
          title: "Totals",
          catalogId: "test",
          metadata: { extensions: { "acme.track": "totals" } },
          accessibility: {
            label: { "@path": "/name" },
            description: "The totals of the order",
            live: "polite",
            hidden: { "@path": "/hide" },
          },
        },
      ],
      { name: "Order totals", hide: false },
    );
    const section = panel(view.container);
    expect(section.getAttribute("aria-label")).toBe("Order totals");
    expect(section.getAttribute("aria-description")).toBe(
      "The totals of the order",
    );
    expect(section.getAttribute("aria-live")).toBe("polite");
    expect(section.getAttribute("aria-hidden")).toBeNull();
    view.update(
      updateDataModel("/name", "Cart totals"),
      updateDataModel("/hide", true),
    );
    expect(section.getAttribute("aria-label")).toBe("Cart totals");
    expect(section.getAttribute("aria-hidden")).toBe("true");
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("hides and announces a component that does not read the envelope itself", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Rows",
          rows: [{ label: "a", value: 1 }],
          accessibility: { hidden: true, live: "polite", label: "Totals" },
        },
      ],
      {},
    );
    // The host element of the component is the wrapper.
    const wrapper = view.container.querySelector("[data-a2ui-accessibility]")!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.getAttribute("aria-live")).toBe("polite");
    // The name needs an element with a role; the wrapper has none.
    expect(wrapper.hasAttribute("aria-label")).toBe(false);
    expect(wrapper.querySelector("dl")).not.toBeNull();
  });

  it("keeps the component mounted when a bound hidden flips", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Panel",
          title: "Totals",
          accessibility: { hidden: { "@path": "/hide" } },
        },
      ],
      { hide: false },
    );
    const section = panel(view.container);
    const wrapper = section.parentElement!;
    expect(wrapper.hasAttribute("data-a2ui-accessibility")).toBe(true);
    expect(wrapper.hasAttribute("aria-hidden")).toBe(false);
    view.update(updateDataModel("/hide", true));
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    // The same elements: nothing was remounted.
    expect(panel(view.container)).toBe(section);
    view.update(updateDataModel("/hide", false));
    expect(wrapper.hasAttribute("aria-hidden")).toBe(false);
    expect(panel(view.container)).toBe(section);
  });

  it("names nothing while a label is a binding to a missing value, without an error", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Panel",
        title: "Totals",
        accessibility: { label: { "@path": "/missing" } },
      },
    ]);
    expect(panel(view.container).getAttribute("aria-label")).toBeNull();
    expect(view.reportError).not.toHaveBeenCalled();
  });

  it("renders the component when its accessibility cannot be computed yet, and names it once the data is there", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Panel",
        title: "Totals",
        accessibility: {
          label: {
            "@call": "formatString",
            args: { value: "${formatNumber(value: /count)} items" },
          },
          hidden: true,
        },
      },
    ]);
    // formatNumber of a missing value fails; the component is not at fault,
    // and the other fields of the envelope still apply.
    const section = panel(view.container);
    expect(section.textContent?.trim()).toBe("Totals");
    expect(section.getAttribute("aria-label")).toBeNull();
    expect(section.getAttribute("aria-hidden")).toBe("true");
    expect(view.reportError).not.toHaveBeenCalled();
    view.update(updateDataModel("/count", 1234));
    expect(panel(view.container).getAttribute("aria-label")).toBe(
      "1,234 items",
    );
  });
});
