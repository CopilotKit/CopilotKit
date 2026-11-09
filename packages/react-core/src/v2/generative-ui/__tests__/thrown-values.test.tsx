import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toError } from "../boundaries";
import { createGenerativeUI } from "../catalog";
import { domGenerativeUIHost } from "../host";
import {
  createHarness,
  expectContained,
  reported,
} from "./containment-harness";

// Code may throw any value. Each place that turns one into a message must
// not throw itself while doing so, and must keep what the value says.

/** An object that `String()` cannot convert: it has no prototype. */
const unprintable = () => Object.create(null) as object;

describe("toError", () => {
  it("returns an Error as it is", () => {
    const error = new TypeError("t");
    expect(toError(error)).toBe(error);
  });

  it("keeps an error of another realm, which has a string message", () => {
    const foreign = {
      [Symbol.toStringTag]: "Error",
      name: "Error",
      message: "from a frame",
    };
    expect(toError(foreign)).toBe(foreign);
  });

  it("wraps an object merely tagged Error, which has no string message", () => {
    for (const tagged of [
      { [Symbol.toStringTag]: "Error" },
      { [Symbol.toStringTag]: "Error", message: 42 },
    ]) {
      const error = toError(tagged);
      expect(error).toBeInstanceOf(Error);
      expect(typeof error.message).toBe("string");
      expect(error.cause).toBe(tagged);
    }
  });

  it("uses the message of a thrown plain object", () => {
    const thrown = { message: "quota exceeded", code: 429 };
    const error = toError(thrown);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("quota exceeded");
    expect(error.cause).toBe(thrown);
  });

  it("describes a plain object without a message by its data, not [object Object]", () => {
    expect(toError({ code: 429 }).message).toBe(
      'A value that is not an Error was thrown: {"code":429}',
    );
  });

  it("does not throw for a value that cannot be converted or read", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        getPrototypeOf() {
          throw new Error("trap");
        },
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const value of [unprintable(), hostile]) {
      const error = toError(value);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/^A value that is not an Error was thrown/);
    }
  });
});

function Field({
  value,
  total,
  setValue,
}: {
  value: string;
  total: number;
  setValue: (value: string) => void;
}) {
  return (
    <button type="button" onClick={() => setValue("typed")}>
      {value}
      {total}
    </button>
  );
}
function Probe({ total }: { total: number }) {
  return <span data-testid="probe">{total}</span>;
}

describe("a selector or a setter that throws a value String() cannot convert", () => {
  const ui = createGenerativeUI({
    id: "thrown-values",
    state: { count: z.number() },
    components: {
      Field: {
        component: Field,
        props: z.object({ value: z.string(), total: z.number() }),
        bind: { total: () => 1 },
        writable: ["value"],
      },
      Probe: {
        component: Probe,
        props: z.object({ total: z.number() }),
        bind: {
          total: () => {
            throw unprintable();
          },
        },
      },
    },
  });
  const { renderWithHost } = createHarness(ui, "thrown-values");

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports the selector's failure as such, not a TypeError of the conversion", () => {
    const harness = renderWithHost(domGenerativeUIHost, [
      { id: "root", component: "Probe" },
    ]);
    expectContained(harness.onEscape);
    const reports = reported(harness.reportError);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.error.message).toContain(
      "total: selector threw: A value that is not an Error was thrown",
    );
    expect(reports[0]!.error.message).not.toContain("primitive");
  });

  it("reports the setter's failure instead of throwing from the event handler", () => {
    const harness = renderWithHost(
      domGenerativeUIHost,
      [{ id: "root", component: "Field", value: { "@path": "/v" } }],
      {
        data: { "/v": "start" },
        prepare: (manager) => {
          manager.setOwnedValue = () => {
            throw unprintable();
          };
        },
      },
    );
    const uncaught = vi.fn();
    window.addEventListener("error", uncaught);
    try {
      fireEvent.click(screen.getByRole("button"));
    } finally {
      window.removeEventListener("error", uncaught);
    }
    expect(uncaught).not.toHaveBeenCalled();
    const reports = reported(harness.reportError);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: "props",
      componentId: "root",
      error: {
        message: "setValue: A value that is not an Error was thrown: {}",
      },
    });
  });
});
