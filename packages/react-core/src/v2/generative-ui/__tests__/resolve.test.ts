import { describe, expect, it } from "vitest";
import { GENERATIVE_UI_FUNCTIONS } from "@copilotkit/shared";
import { ExpressionError } from "../functions";
import {
  containsDynamicValue,
  resolveDynamicValue,
  tryResolveDynamicValue,
} from "../resolve";
import type { ResolveContext } from "../resolve";

/** A data reader over a plain object, by JSON pointer. */
function reader(data: Record<string, unknown>) {
  return {
    get(path: string) {
      if (path === "/") return data;
      return path
        .slice(1)
        .split("/")
        .reduce<unknown>(
          (value, key) =>
            typeof value === "object" && value !== null
              ? (value as Record<string, unknown>)[key]
              : undefined,
          data,
        );
    },
  };
}

const data = reader({
  price: 1599,
  qty: 3,
  name: "Ada",
  email: "ada@example.com",
  items: [{ label: "A" }, { label: "B" }],
  flags: { ok: true },
});
const root: ResolveContext = { data, basePath: undefined };
const resolve = (value: unknown, context: ResolveContext = root) =>
  resolveDynamicValue(value, context);

describe("resolveDynamicValue: bindings", () => {
  it("reads a top-level binding and reports the path it read", () => {
    const { value, paths } = resolve({ "@path": "/price" });
    expect(value).toBe(1599);
    expect([...paths]).toEqual(["/price"]);
  });

  it("reads bindings at any depth and keeps the rest of the value", () => {
    const { value, paths } = resolve({
      rows: [{ label: "Price", value: { "@path": "/price" } }, { label: "x" }],
      title: "Specs",
    });
    expect(value).toEqual({
      rows: [{ label: "Price", value: 1599 }, { label: "x" }],
      title: "Specs",
    });
    expect([...paths]).toEqual(["/price"]);
  });

  it("keeps the identity of a value with nothing dynamic in it", () => {
    const literal = { rows: [{ label: "a" }], nested: { deep: [1, 2] } };
    expect(resolve(literal).value).toBe(literal);
    expect(resolve(literal).paths.size).toBe(0);
  });

  it("resolves a relative path against the template item", () => {
    const { value, paths } = resolve(
      { "@path": "label" },
      { data, basePath: "/items/1" },
    );
    expect(value).toBe("B");
    expect([...paths]).toEqual(["/items/1/label"]);
  });

  it("leaves an event binding alone", () => {
    const binding = {
      event: { name: "pick", context: { p: { "@path": "/price" } } },
    };
    expect(resolve(binding).value).toBe(binding);
  });
});

describe("resolveDynamicValue: function values", () => {
  it("resolves the documented series example to numbers and recomputes from bound data", () => {
    const example = {
      "@call": "series",
      args: {
        count: 6,
        item: { month: "${i}", cost: "${i * monthlyCost}" },
        monthlyCost: { "@path": "/monthlyCost" },
      },
    };
    expect(GENERATIVE_UI_FUNCTIONS.series.description).toContain(
      JSON.stringify(example),
    );
    const state = { monthlyCost: 75 };
    const context: ResolveContext = {
      data: reader(state),
      basePath: undefined,
    };
    for (const monthlyCost of [75, 150]) {
      state.monthlyCost = monthlyCost;
      const { value, paths } = resolve(example, context);
      expect(value).toEqual(
        Array.from({ length: 6 }, (_, index) => ({
          month: index + 1,
          cost: (index + 1) * monthlyCost,
        })),
      );
      expect([...paths]).toEqual(["/monthlyCost"]);
    }
  });

  it("gives the @index of a template item, plus an offset, and nothing outside a template", () => {
    expect(
      resolve({ "@call": "@index" }, { data, basePath: "/items/1" }).value,
    ).toBe(1);
    expect(
      resolve(
        { "@call": "@index", args: { offset: 1 } },
        { data, basePath: "/items/1" },
      ).value,
    ).toBe(2);
    expect(resolve({ "@call": "@index" }).value).toBeUndefined();
  });

  it("formats a bound number as currency and reports the path", () => {
    const { value, paths } = resolve({
      "@call": "formatCurrency",
      args: { value: { "@path": "/price" }, currency: "USD" },
    });
    expect(value).toBe("$1,599.00");
    expect([...paths]).toEqual(["/price"]);
  });

  it("coerces a validator result to a boolean in a prop, and keeps it under a check condition", () => {
    const check = { "@call": "email", args: { value: { "@path": "/email" } } };
    expect(resolve(check).value).toBe(true);
    // A key named condition outside of checks is an ordinary value.
    expect(resolve({ condition: check }).value).toEqual({ condition: true });
    expect(
      resolveDynamicValue([{ condition: check }], root, { isChecks: true })
        .value,
    ).toEqual([{ condition: { valid: true } }]);
    expect(
      resolve({
        checks: [{ condition: { "@call": "required", args: { value: "" } } }],
      }).value,
    ).toEqual({
      checks: [
        { condition: { valid: false, message: "Required", code: "required" } },
      ],
    });
    expect(
      resolveDynamicValue(check, root, { keepValidation: true }).value,
    ).toEqual({ valid: true });
  });

  it("keeps a validator result only as the condition of a check", () => {
    const required = { "@call": "required", args: { value: "" } };
    expect(resolve({ checks: [{ condition: required }] }).value).toEqual({
      checks: [
        { condition: { valid: false, message: "Required", code: "required" } },
      ],
    });
    // An arg that happens to be named condition is a plain boolean.
    expect(
      resolve({
        "@call": "calc",
        args: { expression: "condition ? 1 : 0", condition: required },
      }).value,
    ).toBe(0);
    expect(resolve({ other: { condition: required } }).value).toEqual({
      other: { condition: false },
    });
  });

  it("combines validators with and, or and not", () => {
    const required = {
      "@call": "required",
      args: { value: { "@path": "/name" } },
    };
    const email = { "@call": "email", args: { value: "nope" } };
    expect(
      resolve({ "@call": "and", args: { values: [required, email] } }).value,
    ).toBe(false);
    expect(
      resolve({ "@call": "or", args: { values: [required, email] } }).value,
    ).toBe(true);
    expect(resolve({ "@call": "not", args: { value: email } }).value).toBe(
      true,
    );
  });

  it("throws an ExpressionError for an unknown function, bad args, or openUrl outside a gesture", () => {
    expect(() => resolve({ "@call": "formatPrice" })).toThrow(ExpressionError);
    expect(() =>
      resolve({ "@call": "formatNumber", args: { value: "x" } }),
    ).toThrow("value must be a number");
    expect(() =>
      resolve({ "@call": "openUrl", args: { url: "https://x" } }),
    ).toThrow("is not a value");
  });
});

describe("resolveDynamicValue: formatString", () => {
  const format = (value: string, context: ResolveContext = root) =>
    resolve({ "@call": "formatString", args: { value } }, context);

  it("interpolates absolute and relative paths and literals", () => {
    expect(format("Hi ${/name}, ${/qty} items").value).toBe("Hi Ada, 3 items");
    expect(format("${label}!", { data, basePath: "/items/0" }).value).toBe(
      "A!",
    );
    expect(format("${'a'} ${\"b\"} ${1.5} ${true} ${null}|").value).toBe(
      "a b 1.5 true |",
    );
    expect([...format("${/name} ${/qty}").paths]).toEqual(["/name", "/qty"]);
  });

  it("calls functions with named args, nested", () => {
    expect(
      format("${/qty} × ${formatCurrency(value: /price, currency: 'EUR')}")
        .value,
    ).toBe("3 × €1,599.00");
    expect(
      format("${pluralize(value: /qty, one: 'item', other: 'items')}").value,
    ).toBe("items");
    expect(format("${formatNumber(value: 1234.5, decimals: 1)}").value).toBe(
      "1,234.5",
    );
    expect(format("${@index}", { data, basePath: "/items/1" }).value).toBe("1");
  });

  it("computes with calc inside formatString and resolves series to a list", () => {
    expect(
      format(
        "${formatCurrency(value: calc(expression: 'qty * price * 0.8', qty: /qty, price: /price), currency: 'EUR')}",
      ).value,
    ).toBe("€3,837.60");
    const { value, paths } = resolve({
      "@call": "series",
      args: {
        count: 2,
        variable: "m",
        item: { month: "${m}", total: "${m * price}" },
        price: { "@path": "/price" },
      },
    });
    expect(value).toEqual([
      { month: 1, total: 1599 },
      { month: 2, total: 3198 },
    ]);
    expect([...paths]).toEqual(["/price"]);
  });

  it("keeps an escaped \\${ literal and reports a bad expression", () => {
    expect(format("cost: \\${/price}").value).toBe("cost: ${/price}");
    expect(format("${'it\\'s'} ${\"a }\"}").value).toBe("it's a }");
    expect(() => format("${/price")).toThrow("unclosed ${");
    expect(() => format("${formatNumber(1)}")).toThrow(
      "expected an argument name",
    );
    expect(() => format("${/price extra}")).toThrow('unexpected "extra"');
  });
});

describe("tryResolveDynamicValue", () => {
  it("gives the paths read before a failure, so the caller can watch them", () => {
    const attempt = tryResolveDynamicValue(
      { "@call": "formatNumber", args: { value: { "@path": "/empty" } } },
      root,
    );
    expect(attempt.ok).toBe(false);
    expect([...attempt.paths]).toEqual(["/empty"]);
  });
});

describe("containsDynamicValue", () => {
  it("finds a binding or a call at any depth, but not an event binding", () => {
    expect(containsDynamicValue("x")).toBe(false);
    expect(containsDynamicValue({ "@path": "/x" })).toBe(true);
    expect(containsDynamicValue([{ a: { "@call": "formatNumber" } }])).toBe(
      true,
    );
    expect(
      containsDynamicValue({
        event: { name: "x", context: { "@path": "/x" } },
      }),
    ).toBe(false);
  });
});
