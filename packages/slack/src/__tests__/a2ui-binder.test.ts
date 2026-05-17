import { describe, it, expect } from "vitest";
import { isBinding, readPath, resolveProps } from "../a2ui/binder.js";

describe("isBinding", () => {
  it("recognizes { path: string }", () => {
    expect(isBinding({ path: "foo" })).toBe(true);
  });
  it("rejects { path: not-a-string }", () => {
    expect(isBinding({ path: 1 })).toBe(false);
  });
  it("rejects bare strings", () => {
    expect(isBinding("foo")).toBe(false);
  });
  it("rejects arrays", () => {
    expect(isBinding([{ path: "foo" }])).toBe(false);
  });
});

describe("readPath", () => {
  const dm = {
    flights: [
      { airline: "United", price: "$100" },
      { airline: "Delta", price: "$200" },
    ],
    user: { name: "Alice" },
  };

  it("reads absolute paths from root", () => {
    expect(readPath(dm, "/user.name")).toBe("Alice");
  });

  it("reads relative paths off a basePath", () => {
    expect(readPath(dm, "airline", "flights[0]")).toBe("United");
    expect(readPath(dm, "price", "flights[1]")).toBe("$200");
  });

  it("absolute paths ignore basePath", () => {
    expect(readPath(dm, "/flights[0].airline", "anything")).toBe("United");
  });

  it("returns undefined for unknown paths (does not throw)", () => {
    expect(readPath(dm, "missing.field")).toBeUndefined();
  });

  it("supports bracket and dot notation interchangeably", () => {
    expect(readPath(dm, "/flights.0.airline")).toBe("United");
    expect(readPath(dm, "/flights[0].airline")).toBe("United");
  });
});

describe("resolveProps", () => {
  const dm = {
    flights: [{ airline: "United", price: "$100" }],
  };

  it("passes through literal strings unchanged", () => {
    expect(resolveProps({ text: "hello" }, dm, undefined)).toEqual({
      text: "hello",
    });
  });

  it("resolves a top-level { path } binding", () => {
    expect(
      resolveProps({ airline: { path: "/flights[0].airline" } }, dm, undefined),
    ).toEqual({ airline: "United" });
  });

  it("uses basePath for relative bindings", () => {
    expect(
      resolveProps({ airline: { path: "airline" } }, dm, "flights[0]"),
    ).toEqual({ airline: "United" });
  });

  it("recurses into nested objects", () => {
    expect(
      resolveProps(
        {
          action: {
            event: {
              name: "select",
              context: { flightNumber: { path: "airline" } },
            },
          },
        },
        dm,
        "flights[0]",
      ),
    ).toEqual({
      action: {
        event: { name: "select", context: { flightNumber: "United" } },
      },
    });
  });

  it("leaves structural template-children intact", () => {
    const out = resolveProps(
      { children: { componentId: "flight-card", path: "/flights" } },
      dm,
      undefined,
    );
    expect(out.children).toEqual({
      componentId: "flight-card",
      path: "/flights",
    });
  });

  it("does not mutate the input", () => {
    const props = { airline: { path: "airline" } };
    const out = resolveProps(props, dm, "flights[0]");
    expect(props.airline).toEqual({ path: "airline" });
    expect(out).not.toBe(props);
  });
});
