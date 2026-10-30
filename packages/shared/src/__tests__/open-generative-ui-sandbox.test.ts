import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSandboxLocalApi } from "../open-generative-ui-sandbox";

describe("createSandboxLocalApi", () => {
  const tip = (handler: (args: unknown) => unknown) =>
    createSandboxLocalApi([
      {
        name: "tip",
        parameters: z.object({ cents: z.number().max(100) }),
        handler,
      },
    ]).tip!;

  it("passes the parsed value to the handler and returns its result", async () => {
    const handler = vi.fn().mockReturnValue("ok");

    await expect(tip(handler)({ cents: 50, extra: true })).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledWith({ cents: 50 });
  });

  it.each([
    ["an out-of-range value", { cents: 999999 }],
    ["a bare string", "cents"],
    ["null", null],
    ["no argument for a required field", undefined],
  ])("rejects %s without calling the handler", async (_label, args) => {
    const handler = vi.fn();

    await expect(tip(handler)(args)).rejects.toThrow(
      'Invalid arguments for sandbox function "tip"',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("drops every argument after the first", async () => {
    const handler = vi.fn();
    const call = tip(handler) as (...args: unknown[]) => Promise<unknown>;

    await call({ cents: 1 }, { signal: "from the frame" });

    expect(handler.mock.calls[0]).toEqual([{ cents: 1 }]);
  });

  it.each([
    ["z.void()", z.void()],
    ["z.undefined()", z.undefined()],
    ["an optional object", z.object({ a: z.string() }).optional()],
  ])("accepts a call with no argument for %s", async (_label, parameters) => {
    const handler = vi.fn();
    const api = createSandboxLocalApi([{ name: "list", parameters, handler }]);

    await api.list!();

    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("warns on the host when a call is rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(tip(vi.fn())({ cents: 999999 })).rejects.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('sandbox function "tip"'),
    );
    warn.mockRestore();
  });

  it("does not expose inherited object keys as methods", () => {
    const api = createSandboxLocalApi([]);

    expect(Object.getPrototypeOf(api)).toBeNull();
    expect(api.constructor).toBeUndefined();
  });

  it("validates a call with no argument as an empty object", async () => {
    const handler = vi.fn().mockReturnValue("ok");
    const api = createSandboxLocalApi([
      { name: "list", parameters: z.object({}), handler },
    ]);

    await expect(api.list!()).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledWith({});
  });

  it("awaits a schema that validates asynchronously", async () => {
    const handler = vi.fn();
    const api = createSandboxLocalApi([
      {
        name: "check",
        parameters: z.object({
          id: z.string().refine(async (id) => id === "known"),
        }),
        handler,
      },
    ]);

    await expect(api.check!({ id: "other" })).rejects.toThrow();
    await api.check!({ id: "known" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("turns a handler that throws into a rejection", async () => {
    const call = tip(() => {
      throw new Error("boom");
    });

    await expect(call({ cents: 1 })).rejects.toThrow("boom");
  });
});
