import type { ReactNode } from "react";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { useGenerativeUIAccessibility } from "../accessibility";
import { createGenerativeUI } from "../catalog";
import { createGenerativeUIDispatcher } from "../dispatcher";
import { renderSurface } from "../standard/__tests__/render";

function Text({ text }: { text: string | number }) {
  return <span data-testid="text">{String(text)}</span>;
}
function Rows({ rows }: { rows: Array<{ label: string; value: unknown }> }) {
  return (
    <dl>
      {rows.map((row) => (
        <div key={row.label} data-testid={`row-${row.label}`}>
          {row.label}: {String(row.value)}
        </div>
      ))}
    </dl>
  );
}
function Button({
  label,
  onClick,
}: {
  label: string;
  onClick?: (args: Record<string, never>) => Promise<unknown>;
}) {
  return (
    <button type="button" onClick={() => void onClick?.({})}>
      {label}
    </button>
  );
}
function Column({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}
function Panel({ title }: { title: string }) {
  const aria = useGenerativeUIAccessibility();
  return (
    <section data-testid="panel" {...aria}>
      {title}
    </section>
  );
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

const setData = (path: string, value: unknown) => ({
  version: "v1.0" as const,
  updateDataModel: { surfaceId: "surface", path, value },
});

describe("dynamic values in props", () => {
  it("resolves a binding nested in a list prop and updates when the data changes", async () => {
    const v = renderSurface(
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
    expect((await v.findByTestId("row-Price")).textContent).toBe("Price: 10");
    v.update(setData("/price", 12));
    await waitFor(() =>
      expect(v.getByTestId("row-Price").textContent).toBe("Price: 12"),
    );
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("computes a function value from bound data and recomputes on change", async () => {
    const v = renderSurface(
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
    expect((await v.findByTestId("text")).textContent).toBe("2 × €1,599.00");
    v.update(setData("/qty", 3));
    await waitFor(() =>
      expect(v.getByTestId("text").textContent).toBe("3 × €1,599.00"),
    );
  });

  it("falls back and reports when a function value cannot be computed", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Text",
        text: { "@call": "formatNumber", args: { value: "many" } },
      },
    ]);
    await waitFor(() => expect(v.reportError).toHaveBeenCalled());
    const error = v.reportError.mock.calls[0][0];
    expect(error.kind).toBe("props");
    expect(error.error.message).toContain("text: value must be a number");
    expect(v.queryByTestId("text")).toBeNull();
  });

  it("recomputes a series when the data it reads changes", async () => {
    const v = renderSurface(
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
    expect((await v.findByTestId("row-M2")).textContent).toBe("M2: 116");
    v.update(setData("/seats", 3));
    await waitFor(() =>
      expect(v.getByTestId("row-M2").textContent).toBe("M2: 174"),
    );
  });

  it("keeps a bound object that has a valid field, and coerces a validator result inside calc", async () => {
    const v = renderSurface(
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
    expect((await v.findByTestId("row-Profile")).textContent).toBe(
      "Profile: [object Object]",
    );
    expect(v.getByTestId("row-Score").textContent).toBe("Score: 1");
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("recovers once the data that a failed function value read arrives", async () => {
    const v = renderSurface(
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
    await waitFor(() => expect(v.reportError).toHaveBeenCalled());
    expect(v.queryByTestId("text")).toBeNull();
    v.update(setData("/price", 1234));
    expect((await v.findByTestId("text")).textContent).toBe("1,234");
  });

  it("recomputes a value that read a list when an item of the list changes", async () => {
    const v = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Text",
          text: {
            "@call": "formatString",
            args: {
              value: "${and(values: /flags)}",
            },
          },
        },
      ],
      { flags: [true, true] },
    );
    expect((await v.findByTestId("text")).textContent).toBe("true");
    v.update(setData("/flags/0", false));
    await waitFor(() =>
      expect(v.getByTestId("text").textContent).toBe("false"),
    );
  });

  it("resolves a template row again when the template moves to another list", async () => {
    const v = renderSurface(
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
    expect((await v.findByTestId("text")).textContent).toBe("from a");
    v.update({
      version: "v1.0",
      updateComponents: {
        surfaceId: "surface",
        components: [
          {
            id: "root",
            component: "Column",
            children: { componentId: "row", path: "/b" },
          },
        ],
      },
    });
    await waitFor(() =>
      expect(v.getByTestId("text").textContent).toBe("from b"),
    );
  });

  it("gives @index to a template item inside a function value", async () => {
    const v = renderSurface(
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
    const texts = await v.findAllByTestId("text");
    expect(texts.map((t) => t.textContent)).toEqual(["1. a", "2. b"]);
  });
});

describe("dynamic values in event bindings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a URL from a functionCall binding, as a user gesture", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(ui, [
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
    fireEvent.click(await v.findByRole("button", { name: "Docs" }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://example.com/docs",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    expect(v.forwardEvent).not.toHaveBeenCalled();
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("resolves a context whose only key is named like an action binding", async () => {
    const v = renderSurface(
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
    fireEvent.click(await v.findByRole("button", { name: "Go" }));
    await waitFor(() => expect(v.forwardEvent).toHaveBeenCalled());
    expect(v.forwardEvent.mock.calls[0][0].context).toEqual({
      event: "launch",
    });
  });

  it("resolves function values in the userMessage and the context of an event", async () => {
    const v = renderSurface(
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
    fireEvent.click(await v.findByRole("button", { name: "Buy" }));
    await waitFor(() => expect(v.forwardEvent).toHaveBeenCalled());
    const [event] = v.forwardEvent.mock.calls[0];
    expect(event.userMessage).toBe("Buy 2 for Ada");
    expect(event.context).toEqual({
      total: "$5.00",
      nested: { qty: 2 },
    });
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
      if (original)
        Object.defineProperty(navigator, "userActivation", original);
      else delete (navigator as { userActivation?: unknown }).userActivation;
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

  it("runs formatString for a component with literal args", async () => {
    await expect(
      dispatcher.invoke(
        "formatString",
        { value: "${formatNumber(value: 1234)} items" },
        component,
      ),
    ).resolves.toEqual({ ok: true, result: "1,234 items" });
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
  it("resolves accessibility, gives it to the component as ARIA attributes, and keeps catalogId and metadata out of the props", async () => {
    const v = renderSurface(
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
    const panel = await v.findByTestId("panel");
    expect(panel.getAttribute("aria-label")).toBe("Order totals");
    expect(panel.getAttribute("aria-description")).toBe(
      "The totals of the order",
    );
    expect(panel.getAttribute("aria-live")).toBe("polite");
    expect(panel.getAttribute("aria-hidden")).toBeNull();
    act(() =>
      v.update(setData("/name", "Cart totals"), setData("/hide", true)),
    );
    await waitFor(() =>
      expect(v.getByTestId("panel").getAttribute("aria-label")).toBe(
        "Cart totals",
      ),
    );
    expect(v.getByTestId("panel").getAttribute("aria-hidden")).toBe("true");
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("hides and announces a component that does not read the envelope itself", async () => {
    const v = renderSurface(
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
    const wrapper = await waitFor(() => {
      const element = v.container.querySelector("[data-a2ui-accessibility]");
      if (!element) throw new Error("no wrapper");
      return element;
    });
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.getAttribute("aria-live")).toBe("polite");
    // The name needs an element with a role; the wrapper has none.
    expect(wrapper.hasAttribute("aria-label")).toBe(false);
    expect(wrapper.querySelector("dl")).not.toBeNull();
  });

  it("keeps the component mounted when a bound hidden flips", async () => {
    const v = renderSurface(
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
    const panel = await v.findByTestId("panel");
    const wrapper = panel.parentElement!;
    expect(wrapper.hasAttribute("data-a2ui-accessibility")).toBe(true);
    expect(wrapper.hasAttribute("aria-hidden")).toBe(false);
    act(() => v.update(setData("/hide", true)));
    await waitFor(() =>
      expect(wrapper.getAttribute("aria-hidden")).toBe("true"),
    );
    // The same elements: nothing was remounted.
    expect(v.getByTestId("panel")).toBe(panel);
    act(() => v.update(setData("/hide", false)));
    await waitFor(() =>
      expect(wrapper.hasAttribute("aria-hidden")).toBe(false),
    );
    expect(v.getByTestId("panel")).toBe(panel);
  });

  it("names nothing while a label is a binding to a missing value, without an error", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Panel",
        title: "Totals",
        accessibility: { label: { "@path": "/missing" } },
      },
    ]);
    const panel = await v.findByTestId("panel");
    expect(panel.getAttribute("aria-label")).toBeNull();
    expect(v.reportError).not.toHaveBeenCalled();
  });

  it("renders the component when its accessibility cannot be computed yet, and names it once the data is there", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Panel",
        title: "Totals",
        accessibility: {
          label: {
            "@call": "formatString",
            args: {
              value: "${formatNumber(value: /count)} items",
            },
          },
          hidden: true,
        },
      },
    ]);
    // formatNumber of a missing value fails; the component is not at fault,
    // and the other fields of the envelope still apply.
    const panel = await v.findByTestId("panel");
    expect(panel.textContent).toBe("Totals");
    expect(panel.getAttribute("aria-label")).toBeNull();
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(v.reportError).not.toHaveBeenCalled();
    act(() => v.update(setData("/count", 1234)));
    await waitFor(() =>
      expect(v.getByTestId("panel").getAttribute("aria-label")).toBe(
        "1,234 items",
      ),
    );
  });
});

describe("ingest", () => {
  it("does not reject a prop with a nested binding at ingest", () => {
    const v = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Rows",
          rows: [{ label: "x", value: { "@path": "/x" } }],
        },
      ],
      { x: 1 },
    );
    act(() => {});
    expect(v.reportError).not.toHaveBeenCalled();
  });
});
